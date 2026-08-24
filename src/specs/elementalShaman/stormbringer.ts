import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Elemental Shaman — patch 12.1.0 (Midnight, Season 2), Stormbringer raid ST
 * build with the S2 "Ophidian Oracle's Prophecy" tier 2pc+4pc. Alternate build
 * to the default Farseer spec.ts (Icy Veins marks Stormbringer ST as "not
 * recommended" but publishes its priority; modeled here so players can train it).
 * Sources (verified 2026-08-24):
 *  - Icy Veins rotation (Stormbringer ST toggle): icy-veins.com/wow/elemental-shaman-pve-dps-rotation-cooldowns-abilities
 *  - Method: method.gg/guides/elemental-shaman/playstyle-and-rotation (Farseer only; shared core)
 *  - Wowhead/Warcraft Wiki via search: Midnight redesigns — Tempest procs at
 *    0.3% per Maelstrom spent (doubled by Awakening Storms), Arc Discharge
 *    (Tempest grants a Stormkeeper stack), Rolling Thunder (Stormkeeper CD −15s).
 * No Stormbringer raid-ST talent import string is published verbatim by
 * Icy Veins or Method (both only publish Farseer elemental strings) — omitted.
 *
 * Talent assumptions: same spec-tree core as spec.ts (Elemental Blast + Eye of
 * the Storm cost 80, Swelling Maelstrom cap 150, Echo of the Elements, Master
 * of the Elements, Power of the Maelstrom, Voltaic Blaze + Crackling Fury,
 * Apex: Feedback Loop 3/3) with the Stormbringer hero tree: Tempest (proc per
 * Maelstrom spent, 2 charges), Awakening Storms, Arc Discharge, Rolling
 * Thunder. No Ancestors / Ancestral Swiftness (Farseer-only).
 * Stormbringer style per Icy Veins: never hardcast Lava Burst (Lava Surge
 * procs only), spend Maelstrom aggressively to fish Tempest procs.
 * S2 tier: identical to spec.ts (2pc spender +25%; 4pc Flowing Elements +
 * Overcharge! on Stormkeeper/Ascendance fade).
 * APPROX-flagged: Tempest coefficient/Maelstrom gain, proc rates, Voltaic
 * Blaze cooldown, Lava Surge ramp, fixed 25% mastery stand-in.
 */

const MASTERY = 0.25            // APPROX: fixed overload chance stand-in
const OVERLOAD_DMG = 0.25 * 1.10 // 25% base × Feedback Loop +10%
const ASC_OVERLOAD_BONUS = 0.30
const MOTE_MULT = 1.15
const SK_MULT = 2.5
const LB_COEFF = 2.98
const LVB_COEFF = 2.93
const FS_DIRECT = 0.58
const FS_TICK = 0.35
const EB_COEFF = 9.82 * 1.25    // S2 2pc: +25%
const VB_COEFF = 1.76
const FROST_SHOCK_COEFF = 0.72
const TEMPEST_COEFF = 5.6       // APPROX: big Tempest nuke, ~2x a bolt
const TEMPEST_GAIN = 10         // APPROX: Tempest is a builder
const TEMPEST_CHANCE_PER_MAELSTROM = 0.006 // 0.3% base + 0.3% Awakening Storms

function ascUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'ascendance') > 0
}

function tempestUp(s: SimAPI): boolean {
  return s.stacks('player', 'tempest_proc') > 0
}

/** mastery overload rolls for LB / LvB / EB / Tempest casts */
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

/** Stormbringer: each point of Maelstrom spent can charge a Tempest */
function rollTempest(s: SimAPI, spent: number) {
  if (spent <= 0) return
  if (s.rng('tempest') < spent * TEMPEST_CHANCE_PER_MAELSTROM) {
    s.applyAura('player', 'tempest_proc', { stacks: 1 })
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

function applyFlameShock(s: SimAPI) {
  s.applyAura('target', 'flame_shock')
}

export const elementalStormbringer: SpecConfig = {
  name: 'Elemental Shaman',
  specId: 'shaman-elemental',
  specIcon: 'spell_nature_lightning',
  buildId: 'stormbringer',
  resourceName: 'Maelstrom',
  resourceMax: 150, // Swelling Maelstrom
  startingResource: 0,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/shaman/elemental/rotation-cooldowns-pve-dps',
    buildName: 'Stormbringer Raid ST',
    heroTalent: 'Stormbringer',
    // no Stormbringer raid-ST import string is published verbatim (Icy Veins
    // and Method only publish Farseer elemental codes) — intentionally omitted
    retrieved: '2026-08-24',
  },

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
    { id: 'master_of_the_elements', name: 'Master of the Elements', icon: 'spell_fire_masterofelements', duration: 15 },
    { id: 'lava_surge', name: 'Lava Surge', icon: 'spell_shaman_lavasurge', duration: 10 },
    { id: 'power_of_the_maelstrom', name: 'Power of the Maelstrom', icon: 'spell_nature_stormreach', duration: 20, maxStacks: 2 },
    // Arc Discharge lets Tempest push Stormkeeper past its base 2 stacks
    { id: 'stormkeeper', name: 'Stormkeeper', icon: 'ability_thunderking_lightningwhip', duration: 15, maxStacks: 4,
      onExpire: (s) => { s.applyAura('player', 'flowing_elements', { stacks: 2 }); s.applyAura('player', 'overcharge') } },
    { id: 'ascendance', name: 'Ascendance', icon: 'spell_fire_elementaldevastation', duration: 15,
      onExpire: (s) => { s.applyAura('player', 'flowing_elements', { stacks: 2 }); s.applyAura('player', 'overcharge') } },
    // Stormbringer: charged Tempest (2 charges max, don't sit at 2)
    { id: 'tempest_proc', name: 'Tempest', icon: 'spell_nature_callstorm', duration: 30, maxStacks: 2 },
    // S2 4pc: on SK/Asc fade — next 2 bolts/LvBs +25% (4 if both fade), next spender free
    { id: 'flowing_elements', name: 'Flowing Elements', icon: 'spell_nature_lightningoverload', duration: 20, maxStacks: 4 },
    { id: 'overcharge', name: 'Overcharge!', icon: 'spell_nature_wispsplode', duration: 20 },
  ],

  abilities: [
    {
      // One button, as in game: a charged Tempest transforms Lightning Bolt.
      id: 'lightning_bolt',
      name: 'Lightning Bolt',
      icon: 'spell_nature_lightning',
      spellId: 188196,
      castTime: 2.5,
      displayName: (s) => (tempestUp(s) ? 'Tempest' : 'Lightning Bolt'),
      displayIcon: (s) => (tempestUp(s) ? 'spell_nature_callstorm' : 'spell_nature_lightning'),
      displayStacks: (s) => s.stacks('player', 'tempest_proc'),
      castTimeMod: (s, base) =>
        (s.stacks('player', 'stormkeeper') > 0 || tempestUp(s) ? 0 : base),
      onResolve: (s) => {
        if (tempestUp(s)) {
          // Tempest: instant nuke + builder; Arc Discharge grants a Stormkeeper stack
          s.consumeStack('player', 'tempest_proc')
          s.gain(TEMPEST_GAIN, 'tempest')
          const mult = moteMult(s)
          s.damage('Tempest', TEMPEST_COEFF * mult)
          rollOverloads(s, 'Tempest', TEMPEST_COEFF * mult, 3)
          s.applyAura('player', 'stormkeeper', { stacks: 1 })
          return
        }
        s.gain(6, 'lb')
        let mult = moteMult(s)
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
      castTimeMod: (s, base) => (s.auraRemains('player', 'lava_surge') > 0 ? 0 : base),
      onResolve: (s) => {
        s.gain(8, 'lvb')
        if (s.auraRemains('player', 'lava_surge') > 0) s.removeAura('player', 'lava_surge')
        let mult = 1
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
      onResolve: (s) => {
        let spent = 80
        if (s.auraRemains('player', 'overcharge') > 0) {
          s.removeAura('player', 'overcharge')
          spent = 0
        }
        const mult = moteMult(s)
        s.damage('elemental_blast', EB_COEFF * mult)
        rollTempest(s, spent) // Stormbringer: spending fishes Tempest procs
      },
    },
    {
      id: 'stormkeeper',
      name: 'Stormkeeper',
      icon: 'ability_thunderking_lightningwhip',
      spellId: 191634,
      castTime: 1.5,
      cooldown: 45, // 60s − Rolling Thunder 15s
      onResolve: (s) => {
        s.applyAura('player', 'stormkeeper', { stacks: 2 })
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
    'stormkeeper', 'ascendance', 'frost_shock',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'lava_burst': return s.auraRemains('player', 'lava_surge') > 0
      case 'lightning_bolt': return tempestUp(s) || s.stacks('player', 'stormkeeper') > 0
      case 'elemental_blast': return s.auraRemains('player', 'overcharge') > 0
        || s.auraRemains('player', 'master_of_the_elements') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'stormkeeper', text: 'On cooldown (45s with Rolling Thunder), 1-2 GCDs before Ascendance — never hold >10s', when: s => s.cooldownRemains('stormkeeper') === 0 },
    { abilityId: 'ascendance', text: 'On cooldown, right after Stormkeeper — sync with Bloodlust/trinkets', when: s => s.cooldownRemains('ascendance') === 0 },
    { abilityId: 'voltaic_blaze', text: 'Preferred Flame Shock applicator when FS is under 6s' },
    { abilityId: 'flame_shock', text: 'Refresh under 6s if Voltaic Blaze is down' },
    { abilityId: 'elemental_blast', text: '4pc: free +25% cast when Flowing Elements + Overcharge! are up', when: s => s.auraRemains('player', 'overcharge') > 0 },
    { abilityId: 'lava_burst', text: 'ONLY with Lava Surge — never hardcast; arms Master of the Elements', when: s => s.auraRemains('player', 'lava_surge') > 0 },
    { abilityId: 'lightning_bolt', label: 'Tempest', icon: 'spell_nature_callstorm', text: 'Tempest or Stormkeeper bolt with Master of the Elements up', when: s => s.auraRemains('player', 'master_of_the_elements') > 0 && (tempestUp(s) || s.stacks('player', 'stormkeeper') > 0) },
    { abilityId: 'elemental_blast', text: 'Spend at 80 Maelstrom — every point spent can charge a Tempest' },
    { abilityId: 'voltaic_blaze', text: 'On cooldown outside Ascendance (Crackling Fury)' },
    { abilityId: 'lightning_bolt', label: 'Tempest', icon: 'spell_nature_callstorm', text: 'Cast Tempest — never sit at 2 charges', when: s => tempestUp(s) },
    { abilityId: 'lightning_bolt', text: 'Stormkeeper bolts, then filler — always be casting' },
    { abilityId: 'frost_shock', text: 'Movement only' },
  ],

  policy: (s) => {
    const gcd = s.gcdLength()
    const mote = s.auraRemains('player', 'master_of_the_elements') > 0
    const fsRemains = s.auraRemains('target', 'flame_shock')
    const fsRefreshable = fsRemains < 6 // Icy Veins: refresh when ≤6s remain
    const skCd = s.cooldownRemains('stormkeeper')
    const ascCd = s.cooldownRemains('ascendance')

    if (skCd === 0 && (ascCd > 10 || ascCd < gcd)) return 'stormkeeper'
    if (ascCd === 0 && skCd > 15 && fsRemains > 0) return 'ascendance'
    if (!mote && fsRefreshable && (ascCd > 5 || fsRemains === 0)) {
      if (s.isUsable('voltaic_blaze') === true) return 'voltaic_blaze'
      return 'flame_shock'
    }
    // 4pc free spender
    if (s.auraRemains('player', 'overcharge') > 0 && s.stacks('player', 'flowing_elements') > 0
      && s.isUsable('elemental_blast') === true) return 'elemental_blast'
    // Lava Burst ONLY with Lava Surge (never hardcast) — arms MotE
    if (s.auraRemains('player', 'lava_surge') > 0 && !mote
      && s.isUsable('lava_burst') === true && s.timeToUsable('lava_burst') === 0) return 'lava_burst'
    // spend MotE on Tempest / Stormkeeper-empowered bolts
    if (mote && (tempestUp(s) || s.stacks('player', 'stormkeeper') > 0)) return 'lightning_bolt'
    // spend at 80+ — every Maelstrom spent fishes Tempest procs
    if (s.isUsable('elemental_blast') === true && s.timeToUsable('elemental_blast') === 0) return 'elemental_blast'
    // MotE-buffed Flame Shock refresh
    if (mote && fsRefreshable) {
      if (s.isUsable('voltaic_blaze') === true) return 'voltaic_blaze'
      return 'flame_shock'
    }
    // Voltaic Blaze on cooldown outside Ascendance (Crackling Fury)
    if (!ascUp(s) && s.isUsable('voltaic_blaze') === true && fsRemains > 0) return 'voltaic_blaze'
    // never sit at 2 Tempest charges; a charged Tempest is also the best filler
    if (tempestUp(s)) return 'lightning_bolt'
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
