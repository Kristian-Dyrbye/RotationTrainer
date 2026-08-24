import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Assassination Rogue — patch 12.1.0 (Midnight, Season 2), Deathstalker
 * raid ST build (Icy Veins default). Built from the simc `midnight`
 * APL/source and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Energy 100, 10/s base regen (hasted); Combo Points as a
 * 5-stack player aura — the 6/7-CP talents are folded into coefficients
 * (APPROX). Venomous Wounds folded into Rupture ticks (+4 energy each).
 * Talent assumptions: Deathstalker (Deathstalker's Mark simplified: Deathmark
 * and Kingsbane apply 3 stacks; each Envenom consumes one for a plasma hit
 * plus 5 energy — Darkest Night trickle folded), Apex: Vein Ripper 3/3
 * (bleeds +25% during Deathmark — keep them rolling before you press it).
 * S2 tier: 2pc Envenom +15% folded into the coefficient; 4pc Envenom
 * refunds 2s of Kingsbane cooldown.
 * APPROX-flagged: poison proc rates, Kingsbane ramp, auto cadence, Seal
 * Fate as crit-chance extra CP. Damage in AP units.
 */

const AUTO_COEFF = 0.24        // APPROX: DW combined stream
const MUT_COEFF = 1.15         // both daggers
const GARROTE_TICK = 0.30
const RUPTURE_TICK = 0.50
const DP_TICK = 0.34
const ENV_PER_CP = 0.60        // incl. S2 2pc +15%
const KB_HIT = 1.50
const KB_TICK = 0.55           // 7 pulses, ramping (APPROX)
const MARK_HIT = 0.90          // Deathstalker's Mark plasma bolt
const ENVENOM_POISON_MULT = 1.3
const DP_PROC = 0.30           // APPROX: per auto swing

function addCP(s: SimAPI, n: number) {
  s.applyAura('player', 'combo_points', { stacks: n })
}

/** read-and-clear combo points for a finisher */
function spendCP(s: SimAPI): number {
  const cp = s.stacks('player', 'combo_points')
  s.removeAura('player', 'combo_points')
  return cp
}

function applyDeadlyPoison(s: SimAPI) {
  s.applyAura('target', 'deadly_poison')
}

export const assassinationRogue: SpecConfig = {
  name: 'Assassination Rogue',
  specId: 'rogue-assassination',
  specIcon: 'ability_rogue_deadlybrew',
  resourceName: 'Energy',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    // energy regen: 10/s base, scales with haste
    const regen = () => {
      s.gain(5 / s.hasteMult(), 'energy_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
    // dual-wield autos: combined stream; swings can proc Deadly Poison
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      if (s.rng('dp_proc') < DP_PROC && s.auraRemains('target', 'deadly_poison') > 0) {
        applyDeadlyPoison(s)
      }
      s.schedule(s.time + 1.3 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'combo_points', name: 'Combo Points', icon: 'ability_rogue_eviscerate', duration: Infinity, maxStacks: 5 },
    {
      id: 'garrote', name: 'Garrote', icon: 'ability_rogue_garrote', duration: 18, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('garrote', GARROTE_TICK, { tags: ['bleed'] }) },
    },
    {
      id: 'rupture', name: 'Rupture', icon: 'ability_rogue_rupture', duration: 24, pandemic: true, debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          s.damage('rupture', RUPTURE_TICK, { tags: ['bleed'] })
          s.gain(4, 'venomous_wounds') // Venomous Wounds folded
        },
      },
    },
    {
      id: 'deadly_poison', name: 'Deadly Poison', icon: 'ability_rogue_dualweild', duration: 12, pandemic: true, debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          const envenomed = s.auraRemains('player', 'envenom') > 0
          s.damage('deadly_poison', DP_TICK * (envenomed ? ENVENOM_POISON_MULT : 1), { tags: ['poison'] })
        },
      },
    },
    { id: 'envenom', name: 'Envenom', icon: 'ability_rogue_disembowel', duration: 6 },
    { id: 'deathmark', name: 'Deathmark', icon: 'ability_rogue_deathmark', duration: 16, debuff: true },
    { id: 'deathstalkers_mark', name: "Deathstalker's Mark", icon: 'inv_ability_deathstalkerrogue_deathstalkersmark', duration: 60, maxStacks: 3, debuff: true },
  ],

  abilities: [
    {
      id: 'mutilate',
      name: 'Mutilate',
      icon: 'ability_rogue_shadowstrikes',
      spellId: 1329,
      cost: 50,
      onResolve: (s) => {
        s.damage('mutilate', MUT_COEFF)
        applyDeadlyPoison(s)
        // Seal Fate folded: crits award a bonus point (APPROX)
        addCP(s, s.rng('seal_fate') < s.stats.critChance ? 3 : 2)
      },
    },
    {
      id: 'garrote',
      name: 'Garrote',
      icon: 'ability_rogue_garrote',
      spellId: 703,
      cost: 45,
      onResolve: (s) => {
        s.applyAura('target', 'garrote')
        addCP(s, 1)
      },
    },
    {
      id: 'rupture',
      name: 'Rupture',
      icon: 'ability_rogue_rupture',
      spellId: 1943,
      cost: 25,
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const cp = spendCP(s)
        s.applyAura('target', 'rupture', { duration: 4 + 4 * cp })
      },
    },
    {
      id: 'envenom',
      name: 'Envenom',
      icon: 'ability_rogue_disembowel',
      spellId: 32645,
      cost: 35,
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const cp = spendCP(s)
        s.damage('envenom', ENV_PER_CP * cp, { tags: ['poison'] })
        s.applyAura('player', 'envenom', { duration: 1 + cp })
        // Deathstalker's Mark: consume a stack for a plasma hit + energy
        if (s.stacks('target', 'deathstalkers_mark') > 0) {
          s.consumeStack('target', 'deathstalkers_mark')
          s.damage("Deathstalker's Mark", MARK_HIT)
          s.gain(5, 'darkest_night')
        }
        s.reduceCooldown('kingsbane', 2) // S2 4pc
      },
    },
    {
      id: 'kingsbane',
      name: 'Kingsbane',
      icon: 'inv_knife_1h_artifactgarona_d_01',
      spellId: 385627,
      cost: 35,
      cooldown: 60,
      onResolve: (s) => {
        s.damage('Kingsbane', KB_HIT, { tags: ['poison'] })
        addCP(s, 1)
        s.applyAura('target', 'deathstalkers_mark', { stacks: 3 })
        // ramping poison modeled as scheduled pulses (not a tracked debuff)
        for (let i = 1; i <= 7; i++) {
          s.schedule(s.time + i * 2, () => s.damage('Kingsbane', KB_TICK * (1 + 0.1 * i), { tags: ['poison'] }))
        }
      },
    },
    {
      id: 'deathmark',
      name: 'Deathmark',
      icon: 'ability_rogue_deathmark',
      spellId: 360194,
      cooldown: 120,
      onResolve: (s) => {
        s.applyAura('target', 'deathmark')
        s.applyAura('target', 'deathstalkers_mark', { stacks: 3 })
      },
    },
  ],

  actionBar: [
    'mutilate', 'garrote', 'rupture', 'envenom', 'kingsbane', 'deathmark',
  ],

  // Deathmark: +20% everything; Apex Vein Ripper: bleeds a further +25%
  damageMult: (s, _id, tags) => {
    if (s.auraRemains('target', 'deathmark') <= 0) return 1
    return tags.includes('bleed') ? 1.2 * 1.25 : 1.2
  },

  glows: (s, id) => {
    switch (id) {
      case 'envenom': return s.stacks('player', 'combo_points') >= 4
      case 'rupture': return s.stacks('player', 'combo_points') >= 4 && s.auraRemains('target', 'rupture') < 7.2
      case 'garrote': return s.auraRemains('target', 'garrote') < 5.4
      case 'kingsbane': return s.cooldownRemains('kingsbane') === 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'garrote', text: 'Keep it rolling — refresh in pandemic (<5.4s)', when: s => s.auraRemains('target', 'garrote') < 5.4 },
    { abilityId: 'rupture', text: 'At 4-5 CP, refresh in pandemic (<7.2s) — Venomous Wounds energy', when: s => s.stacks('player', 'combo_points') >= 4 && s.auraRemains('target', 'rupture') < 7.2 },
    { abilityId: 'deathmark', text: 'With both bleeds up (Apex: bleeds +25% inside it)', when: s => s.cooldownRemains('deathmark') === 0 },
    { abilityId: 'kingsbane', text: 'Inside Deathmark, or on cooldown when Deathmark is far', when: s => s.cooldownRemains('kingsbane') === 0 },
    { abilityId: 'envenom', text: 'At 4-5 CP — chains the Deathstalker’s Mark plasma hits', when: s => s.stacks('player', 'combo_points') >= 4 },
    { abilityId: 'mutilate', text: 'Builder — pool toward 50 energy, never sit at the cap' },
  ],

  policy: (s) => {
    const cp = s.stacks('player', 'combo_points')
    const garroteR = s.auraRemains('target', 'garrote')
    const ruptureR = s.auraRemains('target', 'rupture')
    const bleedsUp = garroteR > 0 && ruptureR > 0
    const dmUp = s.auraRemains('target', 'deathmark') > 0

    if (garroteR <= 0) return 'garrote'
    if (cp >= 1 && ruptureR <= 0) return 'rupture'
    if (garroteR < 5.4) return 'garrote'
    if (cp >= 4 && ruptureR < 7.2) return 'rupture'
    if (bleedsUp && s.cooldownRemains('deathmark') === 0) return 'deathmark'
    if (bleedsUp && s.cooldownRemains('kingsbane') === 0
      && (dmUp || s.cooldownRemains('deathmark') > 30)) return 'kingsbane'
    if (cp >= 4) return 'envenom'
    return 'mutilate'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const finishers = ['envenom', 'rupture']
    const builders = ['mutilate', 'garrote']
    const sets = [finishers, builders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
