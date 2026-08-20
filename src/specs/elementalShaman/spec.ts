import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Elemental Shaman — patch 12.1.0 (Midnight, Season 2), Farseer raid ST build
 * with the S2 tier 2pc+4pc. Built from the simc `midnight` APL/source and
 * Icy Veins/Method 12.1 guides (post-rework: Icefury, Primordial Wave, manual
 * elementals all removed; Voltaic Blaze added; overloads rebased to 25%).
 *
 * Talent assumptions: Elemental Blast + Eye of the Storm (cost 80), Swelling
 * Maelstrom (cap 150), Echo of the Elements (2 LvB charges), Master of the
 * Elements, Power of the Maelstrom, Crackling Fury, Call of Fire/Fury of the
 * Storms (elementals fold into Asc/SK), Apex: Feedback Loop 3/3.
 * APPROX-flagged numbers need SpellQuery verification. Mastery is fixed at
 * 25% (no mastery input yet); Ancestors are modeled as damage pulses.
 */

const MASTERY = 0.25            // APPROX: fixed overload chance stand-in
const OVERLOAD_DMG = 0.25 * 1.10 // 25% base × Feedback Loop +10%
const ASC_OVERLOAD_BONUS = 0.30
const MOTE_MULT = 1.15
const SK_MULT = 2.5
const ANCESTOR_PULSE = 1.5      // APPROX: ancestor modeled as 3 pulses over 8s
const LB_COEFF = 2.98
const LVB_COEFF = 2.93
const FS_DIRECT = 0.58
const FS_TICK = 0.35
const EB_COEFF = 9.82 * 1.25    // S2 2pc: +25%
const VB_COEFF = 1.76
const FROST_SHOCK_COEFF = 0.72

function ascUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'ascendance') > 0
}

/** Farseer Ancestor: 8s guardian, modeled as 3 Lava Burst-style pulses */
function callAncestor(s: SimAPI) {
  for (const delay of [1.5, 4.5, 7.5]) {
    s.schedule(s.time + delay, () => s.damage('Ancestor', ANCESTOR_PULSE))
  }
}

/** mastery overload rolls for LB / LvB / EB-style casts */
function rollOverloads(s: SimAPI, spellId: string, coeff: number, maelstrom: number) {
  const dmgMult = OVERLOAD_DMG * (ascUp(s) ? 1 + ASC_OVERLOAD_BONUS : 1)
  let overloads = 0
  if (s.rng('overload') < MASTERY) overloads++
  if (ascUp(s)) overloads++ // guaranteed extra overload during Ascendance
  // Feedback Loop node 3: 25% chance an overload duplicates once
  if (overloads > 0 && s.rng('overload_chain') < 0.25) overloads++
  for (let i = 0; i < overloads; i++) {
    s.schedule(s.time + 0.4, () => s.damage(`${spellId} Overload`, coeff * dmgMult))
    s.gain(maelstrom, 'overload')
  }
}

/** consume Master of the Elements on Nature spells */
function moteMult(s: SimAPI, consume = true): number {
  if (s.auraRemains('player', 'master_of_the_elements') > 0) {
    if (consume) s.removeAura('player', 'master_of_the_elements')
    return MOTE_MULT
  }
  return 1
}

/** Ancestral Swiftness: next spell instant, free, +10% */
function swiftness(s: SimAPI): { mult: number } {
  if (s.auraRemains('player', 'ancestral_swiftness') > 0) {
    s.removeAura('player', 'ancestral_swiftness')
    return { mult: 1.10 }
  }
  return { mult: 1 }
}

function applyFlameShock(s: SimAPI) {
  s.applyAura('target', 'flame_shock')
}

export const elementalShaman: SpecConfig = {
  name: 'Elemental Shaman',
  specId: 'shaman-elemental',
  specIcon: 'spell_nature_lightning',
  resourceName: 'Maelstrom',
  resourceMax: 150, // Swelling Maelstrom
  startingResource: 0,

  auras: [
    {
      id: 'flame_shock',
      name: 'Flame Shock',
      icon: 'spell_fire_flameshock',
      duration: 18,
      pandemic: true,
      debuff: true,
      tick: {
        interval: 2,
        hasted: true,
        onTick: (s) => {
          s.damage('flame_shock', FS_TICK)
          // Searing Flames: ~25% chance for 2 Maelstrom (simc-measured)
          if (s.rng('searing_flames') < 0.25) s.gain(2, 'searing_flames')
          // Lava Surge: bad-luck-protection ramp (simc midnight model), ×1.2 Mystic Knowledge
          s.data.surge_attempts = (s.data.surge_attempts ?? 0) + 1
          const a = s.data.surge_attempts
          const chance = Math.max(0, 0.6 - Math.pow(1.16, -2 * (a - 5))) * 1.2
          if (s.rng('lava_surge') < chance) {
            s.data.surge_attempts = 0
            s.applyAura('player', 'lava_surge')
            s.reduceCooldown('lava_burst', 8) // surge refunds a Lava Burst charge
          }
        },
      },
    },
    { id: 'master_of_the_elements', name: 'Master of the Elements', icon: 'spell_shaman_improvedfirenovatotem', duration: 15 },
    { id: 'lava_surge', name: 'Lava Surge', icon: 'spell_shaman_lavasurge', duration: 10 },
    { id: 'power_of_the_maelstrom', name: 'Power of the Maelstrom', icon: 'spell_fire_masterofelements', duration: 20, maxStacks: 2 },
    { id: 'stormkeeper', name: 'Stormkeeper', icon: 'ability_thunderking_lightningwhip', duration: 15, maxStacks: 2,
      onExpire: (s) => { s.applyAura('player', 'flowing_elements', { stacks: 4 }); s.applyAura('player', 'overcharge') } },
    { id: 'ascendance', name: 'Ascendance', icon: 'spell_fire_elementaldevastation', duration: 15,
      onExpire: (s) => { s.applyAura('player', 'flowing_elements', { stacks: 4 }); s.applyAura('player', 'overcharge') } },
    { id: 'ancestral_swiftness', name: 'Ancestral Swiftness', icon: 'inv_ability_farseershaman_ancestralswiftness', duration: 15 },
    // S2 4pc: on SK/Asc fade — next 2-4 bolts +25%, next spender free
    { id: 'flowing_elements', name: 'Flowing Elements', icon: 'spell_nature_lightningoverload', duration: 20, maxStacks: 4 },
    { id: 'overcharge', name: 'Overcharge!', icon: 'spell_nature_wispsplode', duration: 20 },
  ],

  abilities: [
    {
      id: 'lightning_bolt',
      name: 'Lightning Bolt',
      icon: 'spell_nature_lightning',
      spellId: 188196,
      castTime: 2.5,
      castTimeMod: (s, base) =>
        (s.stacks('player', 'stormkeeper') > 0 || s.auraRemains('player', 'ancestral_swiftness') > 0 ? 0 : base),
      onResolve: (s) => {
        s.gain(6, 'lb')
        let mult = moteMult(s) * swiftness(s).mult
        if (s.stacks('player', 'stormkeeper') > 0) {
          s.consumeStack('player', 'stormkeeper')
          mult *= SK_MULT
        }
        if (s.stacks('player', 'flowing_elements') > 0) {
          s.consumeStack('player', 'flowing_elements')
          mult *= 1.25
        }
        s.damage('lightning_bolt', LB_COEFF * mult)
        rollOverloads(s, 'Lightning Bolt', LB_COEFF * mult, 2)
        if (s.rng('potm') < 0.15) s.applyAura('player', 'power_of_the_maelstrom', { stacks: 1 })
        if (s.rng('ancestor') < 0.08) callAncestor(s)
      },
    },
    {
      id: 'lava_burst',
      name: 'Lava Burst',
      icon: 'spell_shaman_lavaburst',
      spellId: 51505,
      castTime: 2.0,
      cooldown: 8,
      charges: 2, // Echo of the Elements
      castTimeMod: (s, base) =>
        (s.auraRemains('player', 'lava_surge') > 0 || s.auraRemains('player', 'ancestral_swiftness') > 0 ? 0 : base),
      onResolve: (s) => {
        s.gain(8, 'lvb')
        if (s.auraRemains('player', 'lava_surge') > 0) s.removeAura('player', 'lava_surge')
        let mult = swiftness(s).mult
        if (s.stacks('player', 'power_of_the_maelstrom') > 0) {
          s.consumeStack('player', 'power_of_the_maelstrom')
          mult *= 1.20
        }
        if (s.stacks('player', 'flowing_elements') > 0) {
          s.consumeStack('player', 'flowing_elements')
          mult *= 1.25
        }
        // always crits with Flame Shock on the target
        const critMult = s.auraRemains('target', 'flame_shock') > 0 ? s.stats.critMult : 1
        s.damage('lava_burst', LVB_COEFF * mult * critMult, { canCrit: critMult === 1 })
        rollOverloads(s, 'Lava Burst', LVB_COEFF * mult, 3)
        s.applyAura('player', 'master_of_the_elements')
        if (s.rng('ancestor') < 0.08) callAncestor(s)
      },
    },
    {
      id: 'flame_shock',
      name: 'Flame Shock',
      icon: 'spell_fire_flameshock',
      spellId: 188389,
      onResolve: (s) => {
        s.gain(3, 'fs')
        s.damage('flame_shock', FS_DIRECT * moteMult(s, false))
        applyFlameShock(s)
        if (s.rng('ancestor') < 0.08) callAncestor(s)
      },
    },
    {
      id: 'voltaic_blaze',
      name: 'Voltaic Blaze',
      icon: 'inv_10_dungeonjewelry_primalist_trinket_1ragingelement_fire',
      spellId: 470057,
      cooldown: 9, // APPROX: 15s base − Crackling Fury 2 ranks
      onResolve: (s) => {
        s.gain(6, 'vb')
        s.damage('voltaic_blaze', VB_COEFF * s.stats.critMult, { canCrit: false }) // always crits
        applyFlameShock(s)
        if (s.rng('ancestor') < 0.08) callAncestor(s)
      },
    },
    {
      id: 'elemental_blast',
      name: 'Elemental Blast',
      icon: 'shaman_talent_elementalblast',
      spellId: 117014,
      castTime: 2.0,
      cooldown: 12,
      cost: 80, // Eye of the Storm
      costMod: (s) => (s.auraRemains('player', 'overcharge') > 0 ? 0 : 80),
      castTimeMod: (s, base) => (s.auraRemains('player', 'ancestral_swiftness') > 0 ? 0 : base),
      onResolve: (s) => {
        if (s.auraRemains('player', 'overcharge') > 0) s.removeAura('player', 'overcharge')
        const mult = moteMult(s) * swiftness(s).mult
        s.damage('elemental_blast', EB_COEFF * mult)
      },
    },
    {
      id: 'stormkeeper',
      name: 'Stormkeeper',
      icon: 'ability_thunderking_lightningwhip',
      spellId: 191634,
      castTime: 1.5,
      cooldown: 60,
      onResolve: (s) => {
        s.applyAura('player', 'stormkeeper', { stacks: 2 })
        callAncestor(s) // Farseer: Stormkeeper calls an Ancestor (+ Storm Elemental, folded in)
      },
    },
    {
      id: 'ascendance',
      name: 'Ascendance',
      icon: 'spell_fire_elementaldevastation',
      spellId: 114050,
      cooldown: 180,
      onResolve: (s) => {
        s.applyAura('player', 'ascendance')
        // on activation: instant Flame Shock + a 50% effectiveness Lava Burst
        applyFlameShock(s)
        s.damage('ascendance', LVB_COEFF * 0.5 * s.stats.critMult, { canCrit: false })
      },
    },
    {
      id: 'ancestral_swiftness',
      name: 'Ancestral Swiftness',
      icon: 'inv_ability_farseershaman_ancestralswiftness',
      spellId: 443454,
      cooldown: 30,
      onResolve: (s) => {
        s.applyAura('player', 'ancestral_swiftness')
        callAncestor(s)
      },
    },
    {
      id: 'frost_shock',
      name: 'Frost Shock',
      icon: 'spell_frost_frostshock',
      spellId: 196840,
      onResolve: (s) => {
        s.gain(3, 'frs')
        s.damage('frost_shock', FROST_SHOCK_COEFF * moteMult(s))
      },
    },
  ],

  actionBar: [
    'lightning_bolt', 'lava_burst', 'flame_shock', 'voltaic_blaze', 'elemental_blast',
    'stormkeeper', 'ascendance', 'ancestral_swiftness', 'frost_shock',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'lava_burst': return s.auraRemains('player', 'lava_surge') > 0
      case 'lightning_bolt': return s.stacks('player', 'stormkeeper') > 0
      case 'elemental_blast': return s.auraRemains('player', 'overcharge') > 0
        || s.auraRemains('player', 'master_of_the_elements') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'stormkeeper', text: 'On cooldown (hold if Ascendance is <10s away — pair them)', when: s => s.cooldownRemains('stormkeeper') === 0 },
    { abilityId: 'ancestral_swiftness', text: 'On cooldown — free instant + Ancestor', when: s => s.cooldownRemains('ancestral_swiftness') === 0 },
    { abilityId: 'voltaic_blaze', text: 'Preferred Flame Shock applicator when FS needs refreshing (MotE down)' },
    { abilityId: 'flame_shock', text: 'Refresh in pandemic (<5.4s) if Voltaic Blaze is down, MotE down' },
    { abilityId: 'ascendance', text: 'On cooldown (unless Stormkeeper is <15s away)', when: s => s.cooldownRemains('ascendance') === 0 },
    { abilityId: 'elemental_blast', text: '4pc: free +25% cast when Flowing Elements + Overcharge! are up', when: s => s.auraRemains('player', 'overcharge') > 0 },
    { abilityId: 'lava_burst', text: 'When Master of the Elements is down and you won’t overcap Maelstrom' },
    { abilityId: 'elemental_blast', text: 'With MotE up, or within 15 Maelstrom of the cap — never overcap' },
    { abilityId: 'lightning_bolt', text: 'Stormkeeper bolts: instant, +150%', when: s => s.stacks('player', 'stormkeeper') > 0 },
    { abilityId: 'lightning_bolt', text: 'Filler — always be casting' },
    { abilityId: 'frost_shock', text: 'Movement only' },
  ],

  policy: (s) => {
    const gcd = s.gcdLength()
    const mote = s.auraRemains('player', 'master_of_the_elements') > 0
    const fsRemains = s.auraRemains('target', 'flame_shock')
    const fsRefreshable = fsRemains < 5.4
    const deficit = 150 - s.insanity
    const skCd = s.cooldownRemains('stormkeeper')
    const ascCd = s.cooldownRemains('ascendance')

    if (skCd === 0 && (ascCd > 10 || ascCd < gcd)) return 'stormkeeper'
    if (s.cooldownRemains('ancestral_swiftness') === 0 && fsRemains > 0) return 'ancestral_swiftness'
    if (!mote && fsRefreshable && ascCd > 5) {
      if (s.isUsable('voltaic_blaze') === true) return 'voltaic_blaze'
      return 'flame_shock'
    }
    if (ascCd === 0 && skCd > 15 && fsRemains > 0) return 'ascendance'
    // 4pc free spender
    if (s.auraRemains('player', 'overcharge') > 0 && s.stacks('player', 'flowing_elements') > 0
      && s.isUsable('elemental_blast') === true) return 'elemental_blast'
    // MotE weave: arm with Lava Burst when MotE is down
    if (!mote && deficit > 15 && s.isUsable('lava_burst') === true && s.timeToUsable('lava_burst') === 0) return 'lava_burst'
    // spend with MotE up or near cap
    if ((mote || deficit < 15) && s.isUsable('elemental_blast') === true && s.timeToUsable('elemental_blast') === 0) return 'elemental_blast'
    // MotE-buffed Flame Shock refresh (simc line)
    if (mote && fsRefreshable) {
      if (s.isUsable('voltaic_blaze') === true) return 'voltaic_blaze'
      return 'flame_shock'
    }
    // Voltaic Blaze on cooldown outside Ascendance (Crackling Fury)
    if (!ascUp(s) && s.isUsable('voltaic_blaze') === true && fsRemains > 0) return 'voltaic_blaze'
    return 'lightning_bolt'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['lightning_bolt', 'frost_shock']
    const fsAppliers = ['flame_shock', 'voltaic_blaze']
    const nukes = ['lava_burst', 'elemental_blast']
    const sets = [fillers, fsAppliers, nukes]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
