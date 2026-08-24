import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Outlaw Rogue — patch 12.1.0 (Midnight, Season 2), Trickster "Single
 * Target" raid build. Verified 2026-08-24 against:
 * - Wowhead rotation guide: https://www.wowhead.com/guide/classes/rogue/outlaw/rotation-cooldowns-pve-dps
 * - Icy Veins rotation: https://www.icy-veins.com/wow/outlaw-rogue-pve-dps-rotation-cooldowns-abilities
 *   (talent string from https://www.icy-veins.com/wow/outlaw-rogue-pve-dps-spec-builds-talents)
 * - Method: https://www.method.gg/guides/outlaw-rogue/playstyle-and-rotation
 *
 * 12.1 redesign modeled: Roll the Bones now rolls a STAGE 1-4 (odds APPROX
 * 55/30/10/5 per Wowhead), each stage granting all previous bonuses —
 * S1 more Opportunity, S2 Sinister Strike +1 CP and +15%, S3 stronger
 * Restless Blades, S4 crit (folded to +8% damage). Reroll while at stage
 * 0-1; Keep it Rolling locks a stage-3+ roll in for 30 more seconds.
 * Opportunity stacks to 6 (Pistol Shot dumps 3 Fan-the-Hammer shots).
 * Trickster: Unseen Blade procs (off double Sinister Strikes, and Killing
 * Spree) stack Escalating Blade — at 4 the next Dispatch becomes Coup de
 * Grace, hitting as if it spent 5 extra CP; Fazed folded to +5% damage
 * taken. Restless Blades: finishers refund cooldown (1s per CP, 1.5s at
 * stage 3+). Adrenaline Rush: +20% haste, +5 energy/s, 4 CP on cast
 * (Improved AR folded).
 * S2 tier: 2pc Dispatch +15% folded into the coefficient; 4pc Sinister
 * Strike has a 12% chance to make the next Dispatch free and full-power.
 * APPROX list: stage odds, proc rates, Keep it Rolling base cooldown
 * (150s so Restless Blades lands it near the guide's ~1min effective),
 * auto cadence, Combat Potency / Main Gauche folded into the swing loop;
 * Blade Rush/Preparation/Supercharger unmodeled. Damage in AP units.
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
const UNSEEN_BLADE_PROC = 0.35 // APPROX: per double Sinister Strike
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

export const outlawRogue: SpecConfig = {
  name: 'Outlaw Rogue',
  specId: 'rogue-outlaw',
  specIcon: 'inv_sword_30',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/rogue/outlaw/rotation-cooldowns-pve-dps',
    buildName: 'Single Target (Raid)',
    heroTalent: 'Trickster',
    // Icy Veins "Outlaw Single Target - Trickster", 12.1
    talentString: 'CQQAAAAAAAAAAAAAAAAAAAAAAAgx2MMzMmZmtZmZmZMmF4BmZbaZw2MAAAAAALLzMzwMzMziZmZbAAAAYmBAjZxwADMLsQLsxAMzgBG',
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
    { id: 'escalating_blade', name: 'Escalating Blade', icon: 'inv_ability_tricksterrogue_coupdegrace', duration: 30, maxStacks: 4 },
    { id: 'free_dispatch', name: 'Free Dispatch', icon: 'ability_rogue_waylay', duration: 15 },
    { id: 'fazed', name: 'Fazed', icon: 'ability_rogue_dirtydeeds', duration: 10, debuff: true },
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
          // Trickster: double strikes can slip in an Unseen Blade
          if (s.rng('unseen_blade') < UNSEEN_BLADE_PROC) {
            s.applyAura('player', 'escalating_blade', { stacks: 1 })
            s.applyAura('target', 'fazed')
          }
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
      displayName: (s) => (s.stacks('player', 'escalating_blade') >= 4 ? 'Coup de Grace' : 'Dispatch'),
      displayIcon: (s) => (s.stacks('player', 'escalating_blade') >= 4 ? 'inv_ability_tricksterrogue_coupdegrace' : 'ability_rogue_waylay'),
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const coup = s.stacks('player', 'escalating_blade') >= 4
        let cp = spendCP(s)
        if (s.auraRemains('player', 'free_dispatch') > 0) {
          s.removeAura('player', 'free_dispatch')
          cp = 6 // S2 4pc: free, hits as if max CP
        }
        const effective = coup ? cp + 5 : cp
        s.damage(coup ? 'coup_de_grace' : 'dispatch', DISPATCH_PER_CP * effective)
        if (coup) {
          s.removeAura('player', 'escalating_blade')
          s.applyAura('target', 'fazed')
        }
        restlessBlades(s, cp)
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
        // Trickster: the flurry weaves in Unseen Blades
        s.applyAura('player', 'escalating_blade', { stacks: 2 })
        restlessBlades(s, cp)
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

  // stage 4 crit folded to +8%; BtE crit window folded to +10%; Fazed +5%
  damageMult: (s) => {
    let m = 1
    if (rtbStage(s) >= 4) m *= 1.08
    if (s.auraRemains('target', 'between_the_eyes') > 0) m *= 1.10
    if (s.auraRemains('target', 'fazed') > 0) m *= 1.05
    return m
  },

  glows: (s, id) => {
    const cp = s.stacks('player', 'combo_points')
    switch (id) {
      case 'roll_the_bones': return s.cooldownRemains('roll_the_bones') === 0 && rtbStage(s) < 2
      case 'keep_it_rolling': return s.cooldownRemains('keep_it_rolling') === 0 && rtbStage(s) >= 3
      case 'pistol_shot': return s.stacks('player', 'opportunity') >= 6
        || (s.stacks('player', 'opportunity') >= 3 && cp <= 3)
      case 'dispatch': return s.auraRemains('player', 'free_dispatch') > 0
        || s.stacks('player', 'escalating_blade') >= 4 || cp >= 6
      case 'between_the_eyes': return cp >= 6 && s.cooldownRemains('between_the_eyes') === 0
      case 'killing_spree': return cp >= 6 && s.cooldownRemains('killing_spree') === 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'roll_the_bones', text: 'On cooldown while at stage 0-1 — keep stage 2+ rolls', when: s => s.cooldownRemains('roll_the_bones') === 0 && rtbStage(s) < 2 },
    { abilityId: 'keep_it_rolling', text: 'Lock in a stage 3+ roll for 30 more seconds', when: s => rtbStage(s) >= 3 && s.cooldownRemains('keep_it_rolling') === 0 },
    { abilityId: 'adrenaline_rush', text: 'Off-GCD, on cooldown at 2 or fewer CP (grants 4 CP)', when: s => s.stacks('player', 'combo_points') <= 2 && s.cooldownRemains('adrenaline_rush') === 0 },
    { abilityId: 'between_the_eyes', text: 'On cooldown with 6 CP', when: s => s.stacks('player', 'combo_points') >= 6 && s.cooldownRemains('between_the_eyes') === 0 },
    { abilityId: 'killing_spree', text: 'On cooldown with 6 CP — feeds Escalating Blade', when: s => s.stacks('player', 'combo_points') >= 6 && s.cooldownRemains('killing_spree') === 0 },
    { abilityId: 'dispatch', text: 'At 6 CP (immediately with a free-Dispatch proc); Coup de Grace at 4 Escalating Blades', when: s => s.stacks('player', 'combo_points') >= 6 || (s.stacks('player', 'combo_points') >= 1 && s.auraRemains('player', 'free_dispatch') > 0) },
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
