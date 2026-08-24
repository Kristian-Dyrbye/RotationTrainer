import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Outlaw Rogue — patch 12.1.0 (Midnight, Season 2), Fatebound "Single
 * Target" raid build (alternate to the default Trickster). Researched
 * 2026-08-24 against:
 * - Wowhead rotation guide: https://www.wowhead.com/guide/classes/rogue/outlaw/rotation-cooldowns-pve-dps
 * - Icy Veins rotation (notes Fatebound and Trickster "play almost
 *   identical" rotationally in 12.1): https://www.icy-veins.com/wow/outlaw-rogue-pve-dps-rotation-cooldowns-abilities
 * - Method playstyle: https://www.method.gg/guides/outlaw-rogue/playstyle-and-rotation
 * - Warcraft Wiki 12.1 Fatebound entries (Hand of Fate / Fateful Ending / Lucky Coin)
 *
 * The 12.1 Roll the Bones rework (stage 1-4, each stage granting all
 * previous bonuses) made Fatebound's coin rolling consistent without
 * Vanish fishing. The Fatebound layer is passive: every finisher spending
 * 5+ CP flips a Fatebound Coin — Heads is a +10% damage buff escalating
 * +2% per consecutive heads; Tails is a Cosmic burst escalating +10% per
 * consecutive tails; the coin is weighted to continue its streak, and the
 * 7th same-face flip grants the Fatebound Lucky Coin (Agility, modeled as
 * +7% damage for 12s). Button priority is the shared Outlaw core: Roll
 * the Bones at stage 0-1, Keep it Rolling on a stage-3+ roll, Adrenaline
 * Rush at low CP, Between the Eyes / Killing Spree / Dispatch at 6+ CP,
 * Fan-the-Hammer Pistol Shots on Opportunity stacks, Sinister Strike.
 *
 * Shared mechanics copied from the base spec.ts: staged RtB odds
 * (55/30/10/5 APPROX), Opportunity to 6 stacks with 3-shot Fan the
 * Hammer, Restless Blades 1s/CP (1.5s at stage 3+), Adrenaline Rush
 * +20% haste +5 energy/s +4 CP, S2 tier (2pc Dispatch +15% in the
 * coefficient; 4pc 12% chance for a free full-power Dispatch).
 * APPROX list: coin streak weighting (60% continue), Lucky Coin as +7%
 * damage 12s, tails coefficient, stage odds, proc rates, Keep it Rolling
 * base cooldown 150s, Killing Spree kept from the spec tree (Trickster's
 * Unseen Blade/Coup de Grace layer removed — that is the other hero tree).
 * No talent import string: Icy Veins and Method publish only
 * Trickster-labeled Outlaw loadouts for 12.1. Damage in AP units.
 */

const AUTO_COEFF = 0.27
const MG_COEFF = 0.25          // Main Gauche proc hit
const SS_COEFF = 1.05
const SS_EXTRA_CHANCE = 0.35   // APPROX; +20% at stage 1+
const PS_COEFF = 0.85
const PS_FAN_COEFF = 1.10      // per Fan the Hammer shot
const DISPATCH_PER_CP = 0.63   // incl. S2 2pc +15%
const BTE_PER_CP = 0.60
const KSPREE_PER_CP = 0.20     // per hit, 5 hits
const TAILS_COEFF = 1.68       // Hand of Fate: Tails, 168% AP (Warcraft Wiki)
const TAILS_STREAK = 0.10      // +10% per consecutive tails
const HEADS_BASE = 0.10        // first heads +10% damage
const HEADS_STREAK = 0.02      // +2% per additional consecutive heads
const LUCKY_COIN_MULT = 1.07   // Agility buff folded to +7% damage
const COIN_CONTINUE = 0.60     // APPROX: weighting toward keeping the streak
const T2_4PC_PROC = 0.12
const RB_ABILITIES = ['adrenaline_rush', 'between_the_eyes', 'killing_spree', 'keep_it_rolling', 'roll_the_bones']

function addCP(s: SimAPI, n: number) {
  s.applyAura('player', 'combo_points', { stacks: n })
}

function spendCP(s: SimAPI): number {
  const cp = s.stacks('player', 'combo_points')
  s.removeAura('player', 'combo_points')
  return cp
}

function rtbStage(s: SimAPI): number {
  return s.stacks('player', 'roll_the_bones')
}

/** Restless Blades: finishers refund cooldowns, 1s/CP (1.5s at stage 3+) */
function restlessBlades(s: SimAPI, cp: number) {
  const rate = rtbStage(s) >= 3 ? 1.5 : 1
  for (const id of RB_ABILITIES) s.reduceCooldown(id, cp * rate)
}

/** Hand of Fate: flip a Fatebound Coin on a 5+ CP finisher */
function flipCoin(s: SimAPI, cp: number) {
  if (cp < 5) return
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

export const outlawFatebound: SpecConfig = {
  name: 'Outlaw Rogue',
  specId: 'rogue-outlaw',
  specIcon: 'inv_sword_30',
  buildId: 'fatebound',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/rogue/outlaw/rotation-cooldowns-pve-dps',
    buildName: 'Single Target (Raid) — Fatebound',
    heroTalent: 'Fatebound',
    // no published Fatebound-labeled import string for 12.1 (Icy Veins and
    // Method both publish only Trickster Outlaw loadouts)
    retrieved: '2026-08-24',
  },
  resourceName: 'Energy',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    const regen = () => {
      s.gain(5 / s.hasteMult(), 'energy_regen')
      if (s.auraRemains('player', 'adrenaline_rush') > 0) s.gain(2.5, 'adrenaline_rush')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
    // dual-wield autos; offhand hits can proc Main Gauche (Combat Potency folded)
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      if (s.rng('main_gauche') < 0.30) {
        s.damage('Main Gauche', MG_COEFF)
        s.gain(3, 'combat_potency')
      }
      s.schedule(s.time + 1.25 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'combo_points', name: 'Combo Points', icon: 'ability_rogue_eviscerate', duration: Infinity, maxStacks: 6 },
    { id: 'roll_the_bones', name: 'Roll the Bones', icon: 'ability_rogue_rollthebones', duration: 30, maxStacks: 4 },
    { id: 'opportunity', name: 'Opportunity', icon: 'ability_rogue_pistolshot', duration: 15, maxStacks: 6 },
    { id: 'adrenaline_rush', name: 'Adrenaline Rush', icon: 'spell_shadow_shadowworddominate', duration: 20 },
    { id: 'free_dispatch', name: 'Free Dispatch', icon: 'ability_rogue_waylay', duration: 15 },
    { id: 'fatebound_heads', name: 'Fatebound Coin: Heads', icon: 'inv_misc_coin_17', duration: 15, maxStacks: 7 },
    { id: 'fatebound_lucky_coin', name: 'Fatebound Lucky Coin', icon: 'inv_misc_coin_01', duration: 12 },
    { id: 'between_the_eyes', name: 'Between the Eyes', icon: 'inv_weapon_rifle_01', duration: 15, debuff: true },
  ],

  abilities: [
    {
      id: 'sinister_strike',
      name: 'Sinister Strike',
      icon: 'spell_shadow_ritualofsacrifice',
      spellId: 193315,
      cost: 45,
      onResolve: (s) => {
        const stage = rtbStage(s)
        const dmg = SS_COEFF * (stage >= 2 ? 1.15 : 1)
        s.damage('sinister_strike', dmg)
        addCP(s, stage >= 2 ? 2 : 1)
        if (s.rng('t2_4pc') < T2_4PC_PROC) s.applyAura('player', 'free_dispatch')
        const doubleChance = SS_EXTRA_CHANCE + (stage >= 1 ? 0.20 : 0)
        if (s.rng('ss_extra') < doubleChance) {
          s.damage('sinister_strike', dmg)
          addCP(s, 1)
          s.applyAura('player', 'opportunity', { stacks: 1 })
        }
      },
    },
    {
      id: 'pistol_shot',
      name: 'Pistol Shot',
      icon: 'ability_rogue_pistolshot',
      spellId: 185763,
      cost: 40,
      costMod: (s) => (s.stacks('player', 'opportunity') > 0 ? 20 : 40),
      onResolve: (s) => {
        const st = s.stacks('player', 'opportunity')
        if (st > 0) {
          // Fan the Hammer: dump up to 3 stacks as extra shots
          const n = Math.min(3, st)
          for (let i = 0; i < n; i++) {
            s.consumeStack('player', 'opportunity')
            s.damage('pistol_shot', PS_FAN_COEFF)
          }
          addCP(s, n)
        } else {
          s.damage('pistol_shot', PS_COEFF)
          addCP(s, 1)
        }
      },
    },
    {
      id: 'dispatch',
      name: 'Dispatch',
      icon: 'ability_rogue_waylay',
      spellId: 2098,
      cost: 35,
      costMod: (s) => (s.auraRemains('player', 'free_dispatch') > 0 ? 0 : 35),
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        let cp = spendCP(s)
        if (s.auraRemains('player', 'free_dispatch') > 0) {
          s.removeAura('player', 'free_dispatch')
          cp = 6 // S2 4pc: free, hits as if max CP
        }
        s.damage('dispatch', DISPATCH_PER_CP * cp)
        restlessBlades(s, cp)
        flipCoin(s, cp) // Hand of Fate
      },
    },
    {
      id: 'between_the_eyes',
      name: 'Between the Eyes',
      icon: 'inv_weapon_rifle_01',
      spellId: 315341,
      cost: 25,
      cooldown: 45,
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const cp = spendCP(s)
        s.damage('between_the_eyes', BTE_PER_CP * cp)
        s.applyAura('target', 'between_the_eyes', { duration: 3 * cp })
        restlessBlades(s, cp)
        flipCoin(s, cp) // Hand of Fate
      },
    },
    {
      id: 'killing_spree',
      name: 'Killing Spree',
      icon: 'ability_rogue_murderspree',
      spellId: 51690,
      cooldown: 90,
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const cp = spendCP(s)
        for (let i = 0; i < 5; i++) {
          s.schedule(s.time + 0.25 * i, () => s.damage('killing_spree', KSPREE_PER_CP * cp))
        }
        restlessBlades(s, cp)
        flipCoin(s, cp) // Hand of Fate
      },
    },
    {
      id: 'roll_the_bones',
      name: 'Roll the Bones',
      icon: 'ability_rogue_rollthebones',
      spellId: 315508,
      cost: 25,
      cooldown: 25,
      onResolve: (s) => {
        s.removeAura('player', 'roll_the_bones')
        const r = s.rng('rtb_stage')
        const stage = r < 0.55 ? 1 : r < 0.85 ? 2 : r < 0.95 ? 3 : 4
        s.applyAura('player', 'roll_the_bones', { stacks: stage })
      },
    },
    {
      id: 'keep_it_rolling',
      name: 'Keep it Rolling',
      icon: 'ability_rogue_keepitrolling',
      spellId: 381989,
      cooldown: 150,
      usable: (s) => (rtbStage(s) > 0 ? true : 'requires a Roll the Bones buff'),
      onResolve: (s) => s.extendAura('player', 'roll_the_bones', 30),
    },
    {
      id: 'adrenaline_rush',
      name: 'Adrenaline Rush',
      icon: 'spell_shadow_shadowworddominate',
      spellId: 13750,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => {
        s.applyAura('player', 'adrenaline_rush')
        addCP(s, 4) // Improved Adrenaline Rush folded (APPROX)
      },
    },
  ],

  actionBar: [
    'sinister_strike', 'pistol_shot', 'dispatch', 'between_the_eyes',
    'killing_spree', 'roll_the_bones', 'keep_it_rolling', 'adrenaline_rush',
  ],

  hasteMod: (s) => (s.auraRemains('player', 'adrenaline_rush') > 0 ? 0.2 : 0),

  // stage 4 crit folded to +8%; BtE crit window folded to +10%; Fatebound:
  // Heads streak +10% then +2%/stack, Lucky Coin +7%
  damageMult: (s) => {
    let m = 1
    if (rtbStage(s) >= 4) m *= 1.08
    if (s.auraRemains('target', 'between_the_eyes') > 0) m *= 1.10
    const heads = s.stacks('player', 'fatebound_heads')
    if (heads > 0) m *= 1 + HEADS_BASE + HEADS_STREAK * (heads - 1)
    if (s.auraRemains('player', 'fatebound_lucky_coin') > 0) m *= LUCKY_COIN_MULT
    return m
  },

  glows: (s, id) => {
    const cp = s.stacks('player', 'combo_points')
    switch (id) {
      case 'roll_the_bones': return s.cooldownRemains('roll_the_bones') === 0 && rtbStage(s) < 2
      case 'keep_it_rolling': return s.cooldownRemains('keep_it_rolling') === 0 && rtbStage(s) >= 3
      case 'pistol_shot': return s.stacks('player', 'opportunity') >= 6
        || (s.stacks('player', 'opportunity') >= 3 && cp <= 3)
      case 'dispatch': return s.auraRemains('player', 'free_dispatch') > 0 || cp >= 6
      case 'between_the_eyes': return cp >= 6 && s.cooldownRemains('between_the_eyes') === 0
      case 'killing_spree': return cp >= 6 && s.cooldownRemains('killing_spree') === 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'roll_the_bones', text: 'On cooldown while at stage 0-1 — keep stage 2+ rolls', when: s => s.cooldownRemains('roll_the_bones') === 0 && rtbStage(s) < 2 },
    { abilityId: 'keep_it_rolling', text: 'Lock in a stage 3+ roll for 30 more seconds', when: s => rtbStage(s) >= 3 && s.cooldownRemains('keep_it_rolling') === 0 },
    { abilityId: 'adrenaline_rush', text: 'Off-GCD, on cooldown at 2 or fewer CP (grants 4 CP)', when: s => s.stacks('player', 'combo_points') <= 2 && s.cooldownRemains('adrenaline_rush') === 0 },
    { abilityId: 'between_the_eyes', text: 'On cooldown with 6 CP — every 5+ CP finisher flips your Fatebound Coin', when: s => s.stacks('player', 'combo_points') >= 6 && s.cooldownRemains('between_the_eyes') === 0 },
    { abilityId: 'killing_spree', text: 'On cooldown with 6 CP', when: s => s.stacks('player', 'combo_points') >= 6 && s.cooldownRemains('killing_spree') === 0 },
    { abilityId: 'dispatch', text: 'At 6 CP (immediately with a free-Dispatch proc) — keeps the coin streak running', when: s => s.stacks('player', 'combo_points') >= 6 || (s.stacks('player', 'combo_points') >= 1 && s.auraRemains('player', 'free_dispatch') > 0) },
    { abilityId: 'pistol_shot', text: 'At 6 Opportunity stacks, or 3+ stacks while at 1-3 CP', when: s => s.stacks('player', 'opportunity') >= 6 || (s.stacks('player', 'opportunity') >= 3 && s.stacks('player', 'combo_points') <= 3) },
    { abilityId: 'sinister_strike', text: 'Builder — pool toward 45 energy, never cap' },
  ],

  policy: (s) => {
    const cp = s.stacks('player', 'combo_points')
    const stage = rtbStage(s)
    const opp = s.stacks('player', 'opportunity')

    if (stage < 2 && s.cooldownRemains('roll_the_bones') === 0) return 'roll_the_bones'
    if (stage >= 3 && s.cooldownRemains('keep_it_rolling') === 0) return 'keep_it_rolling'
    if (cp <= 2 && s.cooldownRemains('adrenaline_rush') === 0) return 'adrenaline_rush'
    if (cp >= 6 && s.cooldownRemains('between_the_eyes') === 0) return 'between_the_eyes'
    if (cp >= 6 && s.cooldownRemains('killing_spree') === 0) return 'killing_spree'
    if (cp >= 1 && s.auraRemains('player', 'free_dispatch') > 0) return 'dispatch'
    if (cp >= 6) return 'dispatch'
    if (opp >= 6) return 'pistol_shot'
    if (opp >= 3 && cp <= 3) return 'pistol_shot'
    return 'sinister_strike'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const finishers = ['dispatch', 'between_the_eyes', 'killing_spree']
    const builders = ['sinister_strike', 'pistol_shot']
    const sets = [finishers, builders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
