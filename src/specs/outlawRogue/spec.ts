import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Outlaw Rogue — patch 12.1.0 (Midnight, Season 2), Fatebound raid ST build
 * (Icy Veins default). Built from the simc `midnight` APL/source and
 * Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Energy 100, 10/s base regen (hasted); Combo Points as a
 * 5-stack player aura — 6/7-CP and Fan the Hammer talents folded (APPROX).
 * Slice and Dice folded into baseline haste/Grand Melee (APPROX).
 * Roll the Bones simplified to 4 distinct buffs (Broadside, Skull &
 * Crossbones, Grand Melee, Buried Treasure), 25% chance to roll two.
 * Fatebound: every finisher flips a coin — heads stacks a damage buff,
 * tails strikes for direct damage. Adrenaline Rush: +20% haste plus a flat
 * +5 energy/s (the rest of its kit folded).
 * Apex: Jackpot! 3/3 — Between the Eyes extends your active Roll the Bones
 * buffs by 4s. S2 tier: 2pc Pistol Shot +30% folded into the coefficient;
 * 4pc finishers have a 20% chance to grant Opportunity.
 * APPROX-flagged: proc rates, coin odds, auto cadence, Combat Potency /
 * Main Gauche folded into the swing loop. Damage in AP units.
 */

const AUTO_COEFF = 0.27
const MG_COEFF = 0.25          // Main Gauche proc hit
const SS_COEFF = 1.05
const SS_EXTRA_CHANCE = 0.45   // APPROX: extra-hit talent bundle
const PS_COEFF = 0.90          // incl. S2 2pc +30%
const PS_OPP_MULT = 2.0
const DISPATCH_PER_CP = 0.55
const BTE_PER_CP = 0.60
const FATE_COIN = 0.90         // tails hit at 5 CP
const OPP_CHANCE = 0.35
const RTB_BUFFS = ['broadside', 'skull_and_crossbones', 'grand_melee', 'buried_treasure']

function addCP(s: SimAPI, n: number) {
  const broadside = s.auraRemains('player', 'broadside') > 0 ? 1 : 0
  s.applyAura('player', 'combo_points', { stacks: n + broadside })
}

function spendCP(s: SimAPI): number {
  const cp = s.stacks('player', 'combo_points')
  s.removeAura('player', 'combo_points')
  return cp
}

/** Fatebound coin flip on every finisher */
function flipCoin(s: SimAPI, cp: number) {
  if (s.rng('fatebound_coin') < 0.5) {
    s.applyAura('player', 'fatebound_coin', { stacks: 1 })
  } else {
    s.damage('Fatebound Coin', FATE_COIN * (cp / 5))
  }
}

/** S2 4pc: finishers can gift an Opportunity proc */
function roll4pc(s: SimAPI) {
  if (s.rng('t33_4pc') < 0.20) s.applyAura('player', 'opportunity')
}

export const outlawRogue: SpecConfig = {
  name: 'Outlaw Rogue',
  specId: 'rogue-outlaw',
  specIcon: 'inv_sword_30',
  resourceName: 'Energy',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    const regen = () => {
      s.gain(5 / s.hasteMult(), 'energy_regen')
      if (s.auraRemains('player', 'adrenaline_rush') > 0) s.gain(2.5, 'adrenaline_rush')
      if (s.auraRemains('player', 'buried_treasure') > 0) s.gain(2, 'buried_treasure')
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
    { id: 'combo_points', name: 'Combo Points', icon: 'ability_rogue_eviscerate', duration: Infinity, maxStacks: 5 },
    { id: 'opportunity', name: 'Opportunity', icon: 'ability_rogue_pistolshot', duration: 12 },
    { id: 'adrenaline_rush', name: 'Adrenaline Rush', icon: 'spell_shadow_shadowworddominate', duration: 20 },
    { id: 'fatebound_coin', name: 'Fatebound: Heads', icon: 'inv_misc_coin_01', duration: 15, maxStacks: 5 },
    { id: 'between_the_eyes', name: 'Between the Eyes', icon: 'inv_weapon_rifle_01', duration: 15, debuff: true },
    { id: 'broadside', name: 'Broadside', icon: 'ability_rogue_rollthebones01', duration: 30 },
    { id: 'skull_and_crossbones', name: 'Skull and Crossbones', icon: 'ability_rogue_rollthebones02', duration: 30 },
    { id: 'grand_melee', name: 'Grand Melee', icon: 'ability_rogue_rollthebones03', duration: 30 },
    { id: 'buried_treasure', name: 'Buried Treasure', icon: 'ability_rogue_rollthebones04', duration: 30 },
  ],

  abilities: [
    {
      id: 'sinister_strike',
      name: 'Sinister Strike',
      icon: 'spell_shadow_ritualofsacrifice',
      spellId: 193315,
      cost: 45,
      onResolve: (s) => {
        s.damage('sinister_strike', SS_COEFF)
        addCP(s, 1)
        if (s.rng('ss_extra') < SS_EXTRA_CHANCE) {
          s.damage('sinister_strike', SS_COEFF)
          addCP(s, 1)
          const oppChance = OPP_CHANCE + (s.auraRemains('player', 'skull_and_crossbones') > 0 ? 0.25 : 0)
          if (s.rng('opportunity') < oppChance) s.applyAura('player', 'opportunity')
        }
      },
    },
    {
      id: 'pistol_shot',
      name: 'Pistol Shot',
      icon: 'ability_rogue_pistolshot',
      spellId: 185763,
      cost: 40,
      costMod: (s) => (s.auraRemains('player', 'opportunity') > 0 ? 20 : 40),
      onResolve: (s) => {
        const opp = s.auraRemains('player', 'opportunity') > 0
        if (opp) s.removeAura('player', 'opportunity')
        s.damage('pistol_shot', PS_COEFF * (opp ? PS_OPP_MULT : 1))
        addCP(s, 1)
      },
    },
    {
      id: 'dispatch',
      name: 'Dispatch',
      icon: 'ability_rogue_waylay',
      spellId: 2098,
      cost: 35,
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const cp = spendCP(s)
        s.damage('dispatch', DISPATCH_PER_CP * cp)
        flipCoin(s, cp)
        roll4pc(s)
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
        // Apex: Jackpot! — extends active Roll the Bones buffs by 4s
        for (const b of RTB_BUFFS) {
          if (s.auraRemains('player', b) > 0) s.extendAura('player', b, 4)
        }
        flipCoin(s, cp)
        roll4pc(s)
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
        for (const b of RTB_BUFFS) s.removeAura('player', b)
        const first = Math.floor(s.rng('rtb_pick') * RTB_BUFFS.length)
        s.applyAura('player', RTB_BUFFS[first])
        if (s.rng('rtb_count') < 0.25) {
          const second = (first + 1 + Math.floor(s.rng('rtb_pick2') * (RTB_BUFFS.length - 1))) % RTB_BUFFS.length
          s.applyAura('player', RTB_BUFFS[second])
        }
      },
    },
    {
      id: 'adrenaline_rush',
      name: 'Adrenaline Rush',
      icon: 'spell_shadow_shadowworddominate',
      spellId: 13750,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => s.applyAura('player', 'adrenaline_rush'),
    },
  ],

  actionBar: [
    'sinister_strike', 'pistol_shot', 'dispatch', 'between_the_eyes',
    'roll_the_bones', 'adrenaline_rush',
  ],

  hasteMod: (s) =>
    (s.auraRemains('player', 'adrenaline_rush') > 0 ? 0.2 : 0)
    + (s.auraRemains('player', 'grand_melee') > 0 ? 0.1 : 0),

  // BtE crit window folded to a flat amp; Fatebound heads +2% per stack
  damageMult: (s) => {
    let m = 1 + 0.02 * s.stacks('player', 'fatebound_coin')
    if (s.auraRemains('target', 'between_the_eyes') > 0) m *= 1.10
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'pistol_shot': return s.auraRemains('player', 'opportunity') > 0
      case 'dispatch': return s.stacks('player', 'combo_points') >= 5
      case 'between_the_eyes': return s.stacks('player', 'combo_points') >= 5 && s.cooldownRemains('between_the_eyes') === 0
      case 'roll_the_bones': return s.cooldownRemains('roll_the_bones') === 0
        && RTB_BUFFS.every(b => s.auraRemains('player', b) <= 0)
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'adrenaline_rush', text: 'Off-GCD, on cooldown', when: s => s.cooldownRemains('adrenaline_rush') === 0 },
    { abilityId: 'roll_the_bones', text: 'When no buff is active (BtE extends good rolls — Apex)', when: s => s.cooldownRemains('roll_the_bones') === 0 && RTB_BUFFS.every(b => s.auraRemains('player', b) <= 0) },
    { abilityId: 'between_the_eyes', text: 'At 5 CP, on cooldown', when: s => s.stacks('player', 'combo_points') >= 5 && s.cooldownRemains('between_the_eyes') === 0 },
    { abilityId: 'dispatch', text: 'At 5 CP when Between the Eyes is down', when: s => s.stacks('player', 'combo_points') >= 5 },
    { abilityId: 'pistol_shot', text: 'Opportunity proc — discounted and doubled', when: s => s.auraRemains('player', 'opportunity') > 0 },
    { abilityId: 'sinister_strike', text: 'Builder — pool toward 45 energy, never cap' },
  ],

  policy: (s) => {
    const cp = s.stacks('player', 'combo_points')
    const rtbActive = RTB_BUFFS.some(b => s.auraRemains('player', b) > 0)

    if (s.cooldownRemains('adrenaline_rush') === 0) return 'adrenaline_rush'
    if (!rtbActive && s.cooldownRemains('roll_the_bones') === 0) return 'roll_the_bones'
    if (cp >= 5) {
      if (s.cooldownRemains('between_the_eyes') === 0) return 'between_the_eyes'
      return 'dispatch'
    }
    if (s.auraRemains('player', 'opportunity') > 0) return 'pistol_shot'
    return 'sinister_strike'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const finishers = ['dispatch', 'between_the_eyes']
    const builders = ['sinister_strike', 'pistol_shot']
    const sets = [finishers, builders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
