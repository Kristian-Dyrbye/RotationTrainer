import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Arcane Mage — patch 12.1.0 (Midnight, Season 2), Sunfury raid ST build
 * (Icy Veins default). Built from the simc `midnight` APL/source and
 * Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Arcane Charges (max 4) as the primary bar. 12.1 removed
 * mana management from the dummy-relevant loop (Evocation folded into
 * Arcane Surge), so mana is not modeled.
 * Talent assumptions: Nether Precision, Arcane Orb, Touch of the Magi
 * (accumulates 20% of damage dealt, then detonates), Arcane Surge,
 * Sunfury sphere loop folded into the Surge/Touch burst (APPROX),
 * Apex: Magi's Echo 2/2 (the Touch detonation echoes at 30%, 2s later).
 * S2 tier: 2pc Arcane Orb loads 2 charges; 4pc Arcane Missiles +25%
 * (folded into the tick coefficient). APPROX-flagged: Clearcasting rate,
 * per-charge scaling. Damage in SP units.
 */

const AB_COEFF = 0.95
const AB_PER_CHARGE = 0.55
const BARRAGE_COEFF = 0.65
const BARRAGE_PER_CHARGE = 0.40
const MISSILE_TICK = 0.42     // 6 waves, incl. S2 4pc +25%
const ORB_COEFF = 1.30
const TOUCH_HIT = 0.50
const TOUCH_PCT = 0.20
const ECHO_PCT = 0.30         // Apex: Magi's Echo
const SURGE_COEFF = 5.8
const SURGE_BUFF = 1.15
const NP_MULT = 1.25
const CC_CHANCE = 0.20        // APPROX: Clearcasting per Arcane Blast

/**
 * All arcane damage funnels through here so Touch of the Magi can bank
 * 20% of everything dealt inside its window (expected-value, APPROX).
 */
function arcaneDamage(s: SimAPI, id: string, coeff: number, opts?: { canCrit?: boolean }) {
  s.damage(id, coeff, { ...opts, tags: ['arcane'] })
  const touch = s.aura('target', 'touch_of_the_magi')
  if (touch) {
    const canCrit = opts?.canCrit ?? true
    const expected = canCrit ? coeff * (1 + s.stats.critChance * (s.stats.critMult - 1)) : coeff
    touch.data.bank = (touch.data.bank ?? 0) + expected
  }
}

export const arcaneMage: SpecConfig = {
  name: 'Arcane Mage',
  specId: 'mage-arcane',
  specIcon: 'spell_holy_magicalsentry',
  resourceName: 'Arcane Charges',
  resourceMax: 4,
  startingResource: 0,

  auras: [
    { id: 'clearcasting', name: 'Clearcasting', icon: 'spell_shadow_manaburn', duration: 20, maxStacks: 3 },
    { id: 'nether_precision', name: 'Nether Precision', icon: 'spell_arcane_blast_nightborne', duration: 12, maxStacks: 2 },
    { id: 'arcane_surge', name: 'Arcane Surge', icon: 'ability_mage_arcanesurge', duration: 15 },
    {
      id: 'touch_of_the_magi', name: 'Touch of the Magi', icon: 'ability_mage_touchofthemagi',
      duration: 10, debuff: true,
      onExpire: (s, aura) => {
        const boom = (aura.data.bank ?? 0) * TOUCH_PCT
        if (boom <= 0) return
        s.damage('Touch of the Magi', boom, { canCrit: false, tags: ['arcane'] })
        // Apex: Magi's Echo — the detonation echoes at 30%, 2s later
        s.schedule(s.time + 2, () => s.damage("Magi's Echo", boom * ECHO_PCT, { canCrit: false, tags: ['arcane'] }))
      },
    },
  ],

  abilities: [
    {
      id: 'arcane_blast',
      name: 'Arcane Blast',
      icon: 'spell_arcane_blast',
      spellId: 30451,
      castTime: 2.25,
      onResolve: (s) => {
        const charges = s.insanity
        let mult = 1 + AB_PER_CHARGE * charges
        if (s.stacks('player', 'nether_precision') > 0) {
          s.consumeStack('player', 'nether_precision')
          mult *= NP_MULT
        }
        arcaneDamage(s, 'arcane_blast', AB_COEFF * mult)
        s.gain(1, 'arcane_blast')
        if (s.rng('clearcasting') < CC_CHANCE) s.applyAura('player', 'clearcasting', { stacks: 1 })
      },
    },
    {
      id: 'arcane_barrage',
      name: 'Arcane Barrage',
      icon: 'ability_mage_arcanebarrage',
      spellId: 44425,
      onResolve: (s) => {
        const charges = s.insanity
        arcaneDamage(s, 'arcane_barrage', BARRAGE_COEFF * (1 + BARRAGE_PER_CHARGE * charges))
        s.spend(4) // spends all charges
      },
    },
    {
      id: 'arcane_missiles',
      name: 'Arcane Missiles',
      icon: 'spell_nature_starfall',
      spellId: 5143,
      usable: (s) => (s.stacks('player', 'clearcasting') > 0 ? true : 'requires Clearcasting'),
      onCastStart: (s) => {
        s.consumeStack('player', 'clearcasting')
        s.applyAura('player', 'nether_precision', { stacks: 2 })
      },
      channel: {
        duration: 2.4,
        ticks: 6,
        hasted: true,
        onTick: (s) => arcaneDamage(s, 'arcane_missiles', MISSILE_TICK),
      },
      onResolve: () => {},
    },
    {
      id: 'arcane_orb',
      name: 'Arcane Orb',
      icon: 'spell_mage_arcaneorb',
      spellId: 153626,
      cooldown: 20,
      onResolve: (s) => {
        arcaneDamage(s, 'arcane_orb', ORB_COEFF)
        s.gain(2, 'arcane_orb') // S2 2pc: loads 2 charges on a single target
      },
    },
    {
      id: 'touch_of_the_magi',
      name: 'Touch of the Magi',
      icon: 'ability_mage_touchofthemagi',
      spellId: 321507,
      cooldown: 45,
      onResolve: (s) => {
        arcaneDamage(s, 'touch_of_the_magi', TOUCH_HIT)
        s.applyAura('target', 'touch_of_the_magi')
        s.gain(4, 'touch_of_the_magi') // loads to 4 charges
      },
    },
    {
      id: 'arcane_surge',
      name: 'Arcane Surge',
      icon: 'ability_mage_arcanesurge',
      spellId: 365350,
      castTime: 2.5,
      cooldown: 90,
      onResolve: (s) => {
        arcaneDamage(s, 'arcane_surge', SURGE_COEFF)
        s.applyAura('player', 'arcane_surge')
        s.gain(4, 'arcane_surge')
      },
    },
  ],

  actionBar: [
    'arcane_blast', 'arcane_barrage', 'arcane_missiles', 'arcane_orb',
    'touch_of_the_magi', 'arcane_surge',
  ],

  damageMult: (s) => (s.auraRemains('player', 'arcane_surge') > 0 ? SURGE_BUFF : 1),

  glows: (s, id) => {
    switch (id) {
      case 'arcane_missiles': return s.stacks('player', 'clearcasting') > 0
      case 'arcane_blast': return s.stacks('player', 'nether_precision') > 0
      case 'arcane_barrage': return s.cooldownRemains('touch_of_the_magi') === 0 && s.insanity === 4
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'arcane_barrage', text: 'Dump 4 charges right before Touch of the Magi', when: s => s.cooldownRemains('touch_of_the_magi') === 0 && s.insanity === 4 },
    { abilityId: 'touch_of_the_magi', text: 'On cooldown, right after the Barrage dump (reloads 4 charges)', when: s => s.cooldownRemains('touch_of_the_magi') === 0 },
    { abilityId: 'arcane_surge', text: 'Inside the Touch of the Magi window', when: s => s.cooldownRemains('arcane_surge') === 0 && s.auraRemains('target', 'touch_of_the_magi') > 0 },
    { abilityId: 'arcane_missiles', text: 'Clearcasting, once Nether Precision is spent', when: s => s.stacks('player', 'clearcasting') > 0 && s.stacks('player', 'nether_precision') === 0 },
    { abilityId: 'arcane_orb', text: 'On cooldown at ≤2 charges', when: s => s.cooldownRemains('arcane_orb') === 0 && s.insanity <= 2 },
    { abilityId: 'arcane_blast', text: 'Filler — spam at 4 charges, never Barrage outside the Touch setup' },
  ],

  policy: (s) => {
    // never clip an Arcane Missiles channel
    if (s.casting?.channel) return null
    const charges = s.insanity
    const cc = s.stacks('player', 'clearcasting')
    const np = s.stacks('player', 'nether_precision')
    const touchCd = s.cooldownRemains('touch_of_the_magi')

    if (touchCd === 0) {
      if (charges === 4) return 'arcane_barrage'
      return 'touch_of_the_magi'
    }
    if (s.cooldownRemains('arcane_surge') === 0 && s.auraRemains('target', 'touch_of_the_magi') > 0) {
      return 'arcane_surge'
    }
    if (cc > 0 && np === 0) return 'arcane_missiles'
    if (s.cooldownRemains('arcane_orb') === 0 && charges <= 2) return 'arcane_orb'
    return 'arcane_blast'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['arcane_blast', 'arcane_missiles']
    const chargeLoaders = ['arcane_orb', 'arcane_blast']
    const touchSetup = ['arcane_barrage', 'touch_of_the_magi']
    const sets = [fillers, chargeLoaders, touchSetup]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
