import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Assassination Rogue — patch 12.1.0 (Midnight, Season 2), Fatebound
 * "Pure Single-Target" raid build (alternate to the default Deathstalker).
 * Researched 2026-08-24 against:
 * - Wowhead rotation guide: https://www.wowhead.com/guide/classes/rogue/assassination/rotation-cooldowns-pve-dps
 * - Maxroll raid guide (Fatebound section): https://maxroll.gg/wow/class-guides/assassination-rogue-raid-guide
 * - Method talents (Fatebound tree, "spec and class tree remain the same
 *   across both Fatebound and Deathstalker"): https://www.method.gg/guides/assassination-rogue/talents
 * - Warcraft Wiki 12.1 Fatebound entries (Hand of Fate / Fateful Ending / Lucky Coin)
 *
 * Fatebound is the passive hero tree: Hand of Fate flips a Fatebound Coin
 * every time a finisher spends 5+ combo points. Heads is a +10% damage
 * buff, escalating +2% per consecutive heads; Tails is a Cosmic burst on
 * the target, escalating +10% per consecutive tails. The coin is weighted
 * to continue its streak; the 7th same-face flip in a row grants the
 * Fatebound Lucky Coin (Agility buff, modeled as +7% damage for 12s).
 * None of it changes button choice — the rotation is the core Assassination
 * loop: Garrote and Rupture upkeep, Deathmark/Kingsbane on cooldown with
 * bleeds up, Envenom at 5+ CP (no Darkest Night 7-CP rule — that is
 * Deathstalker), Ambush on Blindside procs, Mutilate filler.
 *
 * Resource model matches the base spec.ts: Energy 100, 10/s hasted regen;
 * Combo Points as a 7-stack player aura; Venomous Wounds folded into
 * Rupture ticks. S2 tier kept: 2pc Envenom +10% (in coefficient) and the
 * Envenom buff grants +3% damage; 4pc Deadly Poison makes bleeds +10%.
 * Fatebound's passive Envenom amp (Fate Intertwined line) folded into a
 * slightly higher Envenom coefficient.
 * APPROX list: coin streak weighting (60% continue), heads/tails split,
 * Lucky Coin as +7% damage 12s, tails coefficient, poison/Blindside proc
 * rates, Kingsbane ramp, Deathmark as 1.5x bleed/poison + 40 energy.
 * No talent import string: neither Icy Veins nor Method publishes a
 * Fatebound-labeled Assassination raid loadout for 12.1 (Method notes the
 * class/spec trees are unchanged from the Deathstalker raid build).
 * Damage in AP units.
 */

const AUTO_COEFF = 0.24        // APPROX: DW combined stream
const MUT_COEFF = 1.15         // both daggers
const AMBUSH_COEFF = 1.30
const GARROTE_TICK = 0.30
const RUPTURE_TICK = 0.50
const DP_TICK = 0.34
const ENV_PER_CP = 0.62        // incl. S2 2pc +10% and Fatebound Envenom amp
const KB_HIT = 1.50
const KB_TICK = 0.55           // 7 pulses, ramping (APPROX)
const TAILS_COEFF = 1.68       // Hand of Fate: Tails, 168% AP (Warcraft Wiki)
const TAILS_STREAK = 0.10      // +10% per consecutive tails
const HEADS_BASE = 0.10        // first heads +10% damage
const HEADS_STREAK = 0.02      // +2% per additional consecutive heads
const LUCKY_COIN_MULT = 1.07   // Agility buff folded to +7% damage
const COIN_CONTINUE = 0.60     // APPROX: weighting toward keeping the streak
const DP_PROC = 0.30           // APPROX: per auto swing
const BLINDSIDE_PROC = 0.20    // APPROX: per Mutilate

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

/** Hand of Fate: flip a Fatebound Coin on a 5+ CP finisher */
function flipCoin(s: SimAPI) {
  const last = s.data.coinFace ?? -1
  const r = s.rng('fatebound_coin')
  // heads = 1, tails = 0; the coin is weighted to continue its streak
  const face = last === -1 ? (r < 0.5 ? 1 : 0) : (r < COIN_CONTINUE ? last : 1 - last)
  const streak = face === last ? (s.data.coinStreak ?? 0) + 1 : 1
  s.data.coinFace = face
  s.data.coinStreak = streak
  if (face === 1) {
    s.applyAura('player', 'fatebound_heads', { stacks: 1 })
  } else {
    s.removeAura('player', 'fatebound_heads')
    s.damage('Fatebound Coin: Tails', TAILS_COEFF * (1 + TAILS_STREAK * (streak - 1)))
  }
  if (streak >= 7) {
    // Fateful Ending: keep the Lucky Coin
    s.applyAura('player', 'fatebound_lucky_coin')
    s.data.coinStreak = 0
    s.data.coinFace = -1
  }
}

export const assassinationFatebound: SpecConfig = {
  name: 'Assassination Rogue',
  specId: 'rogue-assassination',
  specIcon: 'ability_rogue_deadlybrew',
  buildId: 'fatebound',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/rogue/assassination/rotation-cooldowns-pve-dps',
    buildName: 'Pure Single-Target (Raid) — Fatebound',
    heroTalent: 'Fatebound',
    // no published Fatebound-labeled import string for 12.1 (Icy Veins and
    // Method both publish only Deathstalker Assassination loadouts)
    retrieved: '2026-08-24',
  },
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
    // dual-wield autos: combined stream; swings can refresh Deadly Poison
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
    { id: 'combo_points', name: 'Combo Points', icon: 'ability_rogue_eviscerate', duration: Infinity, maxStacks: 7 },
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
          s.damage('deadly_poison', DP_TICK, { tags: ['poison'] })
        },
      },
    },
    { id: 'envenom', name: 'Envenom', icon: 'ability_rogue_disembowel', duration: 6 },
    { id: 'blindside', name: 'Blindside', icon: 'ability_rogue_focusedattacks', duration: 10 },
    { id: 'deathmark', name: 'Deathmark', icon: 'ability_rogue_deathmark', duration: 16, debuff: true },
    { id: 'fatebound_heads', name: 'Fatebound Coin: Heads', icon: 'inv_misc_coin_17', duration: 15, maxStacks: 7 },
    { id: 'fatebound_lucky_coin', name: 'Fatebound Lucky Coin', icon: 'inv_misc_coin_01', duration: 12 },
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
        if (s.rng('blindside') < BLINDSIDE_PROC) s.applyAura('player', 'blindside')
      },
    },
    {
      id: 'ambush',
      name: 'Ambush',
      icon: 'ability_ambush',
      spellId: 8676,
      cost: 50,
      costMod: (s) => (s.auraRemains('player', 'blindside') > 0 ? 25 : 50),
      usable: (s) => (s.auraRemains('player', 'blindside') > 0 ? true : 'requires Blindside proc'),
      onResolve: (s) => {
        s.removeAura('player', 'blindside')
        s.damage('ambush', AMBUSH_COEFF)
        applyDeadlyPoison(s)
        addCP(s, s.rng('seal_fate_ambush') < s.stats.critChance ? 3 : 2)
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
        if (cp >= 5) flipCoin(s) // Hand of Fate
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
        if (cp >= 5) flipCoin(s) // Hand of Fate
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
        s.gain(40, 'deathmark') // "grants energy" (APPROX)
      },
    },
  ],

  actionBar: [
    'mutilate', 'ambush', 'garrote', 'rupture', 'envenom', 'kingsbane', 'deathmark',
  ],

  // Deathmark "doubles" poisons and bleeds (APPROX flat 1.5x); S2 2pc:
  // Envenom buff grants +3% damage dealt; S2 4pc: Deadly Poison => bleeds
  // +10%; Fatebound: Heads streak +10% then +2%/stack, Lucky Coin +7%
  damageMult: (s, _id, tags) => {
    let m = 1
    if (s.auraRemains('player', 'envenom') > 0) m *= 1.03
    const heads = s.stacks('player', 'fatebound_heads')
    if (heads > 0) m *= 1 + HEADS_BASE + HEADS_STREAK * (heads - 1)
    if (s.auraRemains('player', 'fatebound_lucky_coin') > 0) m *= LUCKY_COIN_MULT
    const affected = tags.includes('bleed') || tags.includes('poison')
    if (affected && s.auraRemains('target', 'deathmark') > 0) m *= 1.5
    if (tags.includes('bleed') && s.auraRemains('target', 'deadly_poison') > 0) m *= 1.10
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'envenom': return s.stacks('player', 'combo_points') >= 5
      case 'rupture': return s.stacks('player', 'combo_points') >= 5 && s.auraRemains('target', 'rupture') < 7.2
      case 'garrote': return s.auraRemains('target', 'garrote') < 5.4
      case 'ambush': return s.auraRemains('player', 'blindside') > 0
      case 'kingsbane': return s.cooldownRemains('kingsbane') === 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'garrote', text: 'Keep it rolling — refresh in pandemic (<5.4s)', when: s => s.auraRemains('target', 'garrote') < 5.4 },
    { abilityId: 'rupture', text: 'Maintain with 5+ CP — refresh in pandemic (<7.2s); 5+ CP finishers flip your Fatebound Coin', when: s => s.stacks('player', 'combo_points') >= 5 && s.auraRemains('target', 'rupture') < 7.2 },
    { abilityId: 'deathmark', text: 'On cooldown with both bleeds up — doubles your poisons and bleeds', when: s => s.cooldownRemains('deathmark') === 0 },
    { abilityId: 'kingsbane', text: 'On cooldown, synced into Deathmark every 2 minutes', when: s => s.cooldownRemains('kingsbane') === 0 },
    { abilityId: 'envenom', text: 'At 5+ CP — keeps the Envenom buff up and the coin streak running', when: s => s.stacks('player', 'combo_points') >= 5 },
    { abilityId: 'ambush', text: 'On Blindside procs — cheap 2-CP builder', when: s => s.auraRemains('player', 'blindside') > 0 },
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
    if (cp >= 5 && ruptureR < 7.2) return 'rupture'
    if (bleedsUp && s.cooldownRemains('deathmark') === 0) return 'deathmark'
    if (bleedsUp && s.cooldownRemains('kingsbane') === 0
      && (dmUp || s.cooldownRemains('deathmark') > 30)) return 'kingsbane'
    if (cp >= 5) return 'envenom'
    if (s.auraRemains('player', 'blindside') > 0) return 'ambush'
    return 'mutilate'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const finishers = ['envenom', 'rupture']
    const builders = ['mutilate', 'ambush', 'garrote']
    const sets = [finishers, builders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
