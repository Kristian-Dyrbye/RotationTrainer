import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Fire Mage — patch 12.1.0 (Midnight, Season 2), Sunfury raid ST build.
 * Modeled from the Wowhead/Icy Veins/Method/Maxroll 12.1 guides (verified
 * 2026-08-24):
 * - https://www.wowhead.com/guide/classes/mage/fire/rotation-cooldowns-pve-dps
 * - https://www.icy-veins.com/wow/fire-mage-pve-dps-rotation-cooldowns-abilities
 * - https://www.method.gg/guides/fire-mage/playstyle-and-rotation
 * - https://maxroll.gg/wow/class-guides/fire-mage-raid-guide
 *
 * 12.1 notes: Phoenix Flames is REMOVED — Fire Blast charges are the only
 * Heating Up converter, so never overcap them. Meteor is talented and used
 * on cooldown (Sunfury Execution: Meteor grants Pyroclasm). Combustion ends
 * into Hyperthermia (Memory of Al'ar): a short window of free instant
 * Pyroblasts. Fired Up (Apex) is folded into the Fire Blast cooldown.
 * Resource model: Spellfire Spheres (max 3) as the primary bar — consuming
 * Hot Streak has a 20% chance to conjure one and the Arcane Phoenix conjures
 * them during Combustion; at 3 they fuse into Burden of Power (+5% next
 * Pyroblast, calls down Glorious Incandescence Meteorites). Savor the
 * Moment extends Combustion per sphere held. Mana not modeled.
 * Crit engine: Heating Up → Hot Streak with expected-value damage plus an
 * explicit crit roll for the proc chain; Combustion and Fire Blast force it.
 * Ignite is a single banked DoT (30% of direct damage, 20% of the bank per
 * tick — simc-style, APPROX).
 * S2 tier: 2pc Pyroclasm Pyroblasts always crit; 4pc Pyroclasm damage +20%
 * and Pyroblast cast time -20% (both modeled).
 * APPROX-flagged: Pyroclasm/Heat Shimmer proc rates, Firestarter (needs
 * target HP — unmodeled), Meteorite/Phoenix coefficients. Damage in SP units.
 */

const FIREBALL_COEFF = 1.05
const PYRO_COEFF = 2.45
const PYRO_CAST_MULT = 0.8       // S2 4pc: Pyroblast cast time -20%
const PYROCLASM_MULT = 1.6       // APPROX: Pyroclasm incl. 4pc +20% and Sunfury Execution
const PYROCLASM_CHANCE = 0.12    // APPROX: per Hot Streak consumed
const FIRE_BLAST_COEFF = 0.83
const SCORCH_COEFF = 0.45
const METEOR_COEFF = 2.2         // APPROX
const METEORITE_COEFF = 1.2      // APPROX: Glorious Incandescence
const PHOENIX_HIT = 0.55         // APPROX: Arcane Phoenix bolts during Combustion
const IGNITE_PCT = 0.30          // mastery stand-in (no mastery input yet)
const IGNITE_TICK_PCT = 0.20
const BURDEN_MULT = 1.05         // 12.1: Burden of Power is +5% Pyroblast
const SPHERE_CHANCE = 0.20       // 12.1: per Hot Streak consumed
const SHIMMER_CHANCE = 0.04      // APPROX: Heat Shimmer per Ignite tick
const COMBUSTION_BASE = 10
const SAVOR_PER_SPHERE = 1       // APPROX: Savor the Moment extension

/**
 * All direct fire damage funnels through here: expected-value damage,
 * Ignite banking, and the Heating Up / Hot Streak crit chain.
 */
function fireDirect(s: SimAPI, id: string, coeff: number, opts?: { guaranteedCrit?: boolean; noProc?: boolean }) {
  const combustion = s.auraRemains('player', 'combustion') > 0
  const critChance = combustion || opts?.guaranteedCrit ? 1 : s.stats.critChance
  const mult = 1 + critChance * (s.stats.critMult - 1)
  s.damage(id, coeff * mult, { canCrit: false, tags: ['fire'] })
  s.data.ignite_bank = (s.data.ignite_bank ?? 0) + coeff * mult * IGNITE_PCT
  s.applyAura('target', 'ignite')
  if (opts?.noProc) return
  const crit = critChance >= 1 || s.rng('fire_crit') < critChance
  if (crit) {
    if (s.auraRemains('player', 'heating_up') > 0) {
      s.removeAura('player', 'heating_up')
      s.applyAura('player', 'hot_streak')
    } else if (s.auraRemains('player', 'hot_streak') === 0) {
      s.applyAura('player', 'heating_up')
    }
  } else if (s.auraRemains('player', 'heating_up') > 0) {
    // a non-crit breaks Heating Up
    s.removeAura('player', 'heating_up')
  }
}

export const fireMage: SpecConfig = {
  name: 'Fire Mage',
  specId: 'mage-fire',
  specIcon: 'spell_fire_firebolt02',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/mage/fire/rotation-cooldowns-pve-dps',
    buildName: 'Fire Raid — Sunfury (Icy Veins 12.1 default)',
    heroTalent: 'Sunfury',
    // Icy Veins "Fire Raid - Sunfury" loadout, 12.1
    talentString: 'C8DAAAAAAAAAAAAAAAAAAAAAAYGGLzMzswMDZmZGAAAGAwMz0sstMDAwmZmx2MzMzYDAAAAAbmZMzAAgZMmZmZMzsMAMzAMGwMMGA',
    retrieved: '2026-08-24',
  },
  resourceName: 'Spellfire Spheres',
  resourceMax: 3,
  startingResource: 0,

  auras: [
    { id: 'heating_up', name: 'Heating Up', icon: 'ability_mage_hotstreak', duration: 10 },
    { id: 'hot_streak', name: 'Hot Streak!', icon: 'ability_mage_hotstreak', duration: 15 },
    { id: 'pyroclasm', name: 'Pyroclasm', icon: 'spell_shaman_lavasurge', duration: 30 },
    { id: 'heat_shimmer', name: 'Heat Shimmer', icon: 'spell_fire_playingwithfire', duration: 20 },
    { id: 'burden_of_power', name: 'Burden of Power', icon: 'spell_mage_flameorb', duration: 30 },
    {
      id: 'combustion', name: 'Combustion', icon: 'spell_fire_sealoffire', duration: COMBUSTION_BASE,
      // Memory of Al'ar: Combustion ends into Hyperthermia
      onExpire: (s) => s.applyAura('player', 'hyperthermia'),
    },
    { id: 'hyperthermia', name: 'Hyperthermia', icon: 'spell_fire_burnout', duration: 5 },
    {
      id: 'ignite', name: 'Ignite', icon: 'spell_fire_incinerate', duration: 9, debuff: true,
      tick: {
        interval: 1, hasted: false,
        onTick: (s) => {
          const bank = s.data.ignite_bank ?? 0
          if (bank <= 1e-6) return
          const dmg = bank * IGNITE_TICK_PCT
          s.data.ignite_bank = bank - dmg
          s.damage('ignite', dmg, { canCrit: false, tags: ['fire'] })
          if (s.rng('heat_shimmer') < SHIMMER_CHANCE) s.applyAura('player', 'heat_shimmer')
        },
      },
    },
  ],

  abilities: [
    {
      id: 'fireball',
      name: 'Fireball',
      icon: 'spell_fire_flamebolt',
      spellId: 133,
      castTime: 2.25,
      onResolve: (s) => fireDirect(s, 'fireball', FIREBALL_COEFF),
    },
    {
      id: 'pyroblast',
      name: 'Pyroblast',
      icon: 'spell_fire_fireball02',
      spellId: 11366,
      castTime: 4.0,
      castTimeMod: (s, base) =>
        s.auraRemains('player', 'hot_streak') > 0 || s.auraRemains('player', 'hyperthermia') > 0
          ? 0
          : base * PYRO_CAST_MULT, // S2 4pc
      onResolve: (s) => {
        const hotStreak = s.auraRemains('player', 'hot_streak') > 0
        const hyperthermia = s.auraRemains('player', 'hyperthermia') > 0
        let mult = 1
        let forceCrit = false
        if (s.auraRemains('player', 'burden_of_power') > 0) {
          s.removeAura('player', 'burden_of_power')
          mult *= BURDEN_MULT
          // Glorious Incandescence — Meteorites rain down
          s.schedule(s.time + 0.5, () => fireDirect(s, 'Meteorite', METEORITE_COEFF, { noProc: true }))
        }
        if (hotStreak) {
          s.removeAura('player', 'hot_streak')
          // Sunfury: consuming Hot Streak can conjure a Spellfire Sphere
          if (s.rng('sphere') < SPHERE_CHANCE) s.gain(1, 'spellfire_sphere')
          if (s.insanity >= 3) {
            s.spend(3)
            s.applyAura('player', 'burden_of_power')
          }
          if (s.rng('pyroclasm') < PYROCLASM_CHANCE) s.applyAura('player', 'pyroclasm')
        } else if (!hyperthermia && s.auraRemains('player', 'pyroclasm') > 0) {
          // hardcast with Pyroclasm: S2 2pc guarantees the crit
          s.removeAura('player', 'pyroclasm')
          mult *= PYROCLASM_MULT
          forceCrit = true
        }
        fireDirect(s, 'pyroblast', PYRO_COEFF * mult, { guaranteedCrit: forceCrit })
      },
    },
    {
      id: 'fire_blast',
      name: 'Fire Blast',
      icon: 'spell_fire_fireball',
      spellId: 108853,
      cooldown: 10, // incl. Fired Up (Apex) recharge reduction
      charges: 3,
      offGcd: true, // castable while casting, like in game
      onResolve: (s) => fireDirect(s, 'fire_blast', FIRE_BLAST_COEFF, { guaranteedCrit: true }),
    },
    {
      id: 'meteor',
      name: 'Meteor',
      icon: 'spell_mage_meteor',
      spellId: 153561,
      cooldown: 45,
      onResolve: (s) => {
        s.schedule(s.time + 1, () => fireDirect(s, 'meteor', METEOR_COEFF, { noProc: true }))
        // Sunfury Execution: Meteor grants Pyroclasm
        s.applyAura('player', 'pyroclasm')
      },
    },
    {
      id: 'scorch',
      name: 'Scorch',
      icon: 'spell_fire_soulburn',
      spellId: 2948,
      castTime: 1.5,
      castTimeMod: (s, base) => (s.auraRemains('player', 'heat_shimmer') > 0 ? 0 : base),
      onResolve: (s) => {
        const shimmer = s.auraRemains('player', 'heat_shimmer') > 0
        if (shimmer) s.removeAura('player', 'heat_shimmer')
        fireDirect(s, 'scorch', SCORCH_COEFF, { guaranteedCrit: shimmer })
      },
    },
    {
      id: 'combustion',
      name: 'Combustion',
      icon: 'spell_fire_sealoffire',
      spellId: 190319,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => {
        // Savor the Moment: spheres held extend the window
        const dur = COMBUSTION_BASE + SAVOR_PER_SPHERE * s.insanity
        s.applyAura('player', 'combustion', { duration: dur })
        // Sunfury: the Arcane Phoenix fights (and conjures spheres) during Combustion
        for (let i = 1; i <= 5; i++) {
          s.schedule(s.time + 2 * i, () => {
            if (s.auraRemains('player', 'combustion') > 0) {
              fireDirect(s, 'Arcane Phoenix', PHOENIX_HIT, { noProc: true })
              if (i % 2 === 0) s.gain(1, 'spellfire_sphere')
            }
          })
        }
      },
    },
  ],

  actionBar: [
    'fireball', 'pyroblast', 'fire_blast', 'meteor', 'scorch', 'combustion',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'pyroblast': return s.auraRemains('player', 'hot_streak') > 0
        || s.auraRemains('player', 'hyperthermia') > 0
        || s.auraRemains('player', 'pyroclasm') > 0
      case 'fire_blast': return s.auraRemains('player', 'heating_up') > 0
      case 'scorch': return s.auraRemains('player', 'heat_shimmer') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'combustion', text: 'On cooldown (off-GCD) — spheres extend it, ends into Hyperthermia', when: s => s.cooldownRemains('combustion') === 0 },
    { abilityId: 'meteor', text: 'On cooldown — grants Pyroclasm (Sunfury Execution); line up with Combustion', when: s => s.cooldownRemains('meteor') === 0 },
    { abilityId: 'pyroblast', text: 'Instant with Hot Streak or during Hyperthermia — never sit on it', when: s => s.auraRemains('player', 'hot_streak') > 0 || s.auraRemains('player', 'hyperthermia') > 0 },
    { abilityId: 'fire_blast', text: 'Convert Heating Up → Hot Streak; dump inside Combustion, never overcap', when: s => s.auraRemains('player', 'heating_up') > 0 && s.chargesOf('fire_blast') > 0 },
    { abilityId: 'pyroblast', text: 'Hardcast with Pyroclasm (2pc: always crits, 4pc: 20% faster)', when: s => s.auraRemains('player', 'pyroclasm') > 0 && s.auraRemains('player', 'hot_streak') === 0 },
    { abilityId: 'scorch', text: 'Instant with Heat Shimmer / Combustion filler once Fire Blast runs dry', when: s => s.auraRemains('player', 'heat_shimmer') > 0 },
    { abilityId: 'fireball', text: 'Filler — always be casting, chain into Pyroblast' },
  ],

  policy: (s) => {
    const hs = s.auraRemains('player', 'hot_streak') > 0
    const hu = s.auraRemains('player', 'heating_up') > 0
    const comb = s.auraRemains('player', 'combustion') > 0
    const hyper = s.auraRemains('player', 'hyperthermia') > 0
    const combCd = s.cooldownRemains('combustion')

    if (combCd === 0) return 'combustion'
    if (s.cooldownRemains('meteor') === 0) return 'meteor'
    if (hs || hyper) return 'pyroblast'
    if (comb) {
      if (s.chargesOf('fire_blast') > 0) return 'fire_blast'
      return 'scorch'
    }
    if (s.auraRemains('player', 'pyroclasm') > 0) return 'pyroblast'
    if (hu && s.chargesOf('fire_blast') > 0 && combCd > 10) return 'fire_blast'
    if (s.auraRemains('player', 'heat_shimmer') > 0) return 'scorch'
    return 'fireball'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['fireball', 'scorch']
    const nukes = ['pyroblast', 'meteor']
    const sets = [fillers, nukes]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
