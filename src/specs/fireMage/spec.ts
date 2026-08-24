import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Fire Mage — patch 12.1.0 (Midnight, Season 2), Sunfury raid ST build
 * (Icy Veins default). Built from the simc `midnight` APL/source and
 * Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Spellfire Spheres (max 3) as the primary bar — each spent
 * Hot Streak conjures one; at 3 they fuse into Burden of Power (next
 * Pyroblast +25% and it calls down a Sunfury Meteorite). Mana is never
 * constraining on a dummy and is not modeled.
 * Crit engine: Heating Up → Hot Streak modeled with expected-value damage
 * plus an explicit crit roll for the proc chain; Combustion and Fire
 * Blast/Phoenix Flames force the roll. Ignite is a single banked DoT
 * (30% of direct damage, 20% of the bank per tick — simc-style, APPROX).
 * Talent assumptions: Sunfury, Phoenix Flames guaranteed crit (APPROX),
 * Apex: Solar Apocalypse 3/3 (Hot Streak Pyroblasts extend Combustion 1s,
 * 4 times). S2 tier: 2pc Phoenix Flames +50% (folded into the coefficient);
 * 4pc Hot Streak Pyroblasts refund 3s of Phoenix Flames recharge.
 * Damage in SP units.
 */

const FIREBALL_COEFF = 1.05
const PYRO_COEFF = 2.45
const FIRE_BLAST_COEFF = 0.83
const PHOENIX_COEFF = 1.20 * 1.5 // S2 2pc: +50%
const SCORCH_COEFF = 0.45
const METEORITE_COEFF = 1.4      // APPROX: Sunfury Meteorite unpublished
const IGNITE_PCT = 0.30          // mastery stand-in (no mastery input yet)
const IGNITE_TICK_PCT = 0.20
const BURDEN_MULT = 1.25

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
  resourceName: 'Spellfire Spheres',
  resourceMax: 3,
  startingResource: 0,

  auras: [
    { id: 'heating_up', name: 'Heating Up', icon: 'ability_mage_hotstreak', duration: 10 },
    { id: 'hot_streak', name: 'Hot Streak!', icon: 'ability_mage_hotstreak', duration: 15 },
    { id: 'burden_of_power', name: 'Burden of Power', icon: 'spell_mage_flameorb', duration: 30 },
    { id: 'combustion', name: 'Combustion', icon: 'spell_fire_sealoffire', duration: 12 },
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
      castTimeMod: (s, base) => (s.auraRemains('player', 'hot_streak') > 0 ? 0 : base),
      onResolve: (s) => {
        let mult = 1
        if (s.auraRemains('player', 'burden_of_power') > 0) {
          s.removeAura('player', 'burden_of_power')
          mult = BURDEN_MULT
          s.schedule(s.time + 0.5, () => fireDirect(s, 'Sunfury Meteorite', METEORITE_COEFF, { noProc: true }))
        }
        if (s.auraRemains('player', 'hot_streak') > 0) {
          s.removeAura('player', 'hot_streak')
          // Sunfury: each spent Hot Streak conjures a Spellfire Sphere
          s.gain(1, 'spellfire_sphere')
          if (s.insanity >= 3) {
            s.spend(3)
            s.applyAura('player', 'burden_of_power')
          }
          s.reduceCooldown('phoenix_flames', 3) // S2 4pc
          // Apex: Solar Apocalypse — Hot Streak Pyros extend Combustion 1s, 4×
          const comb = s.aura('player', 'combustion')
          if (comb && (comb.data.ext ?? 0) < 4) {
            comb.data.ext = (comb.data.ext ?? 0) + 1
            s.extendAura('player', 'combustion', 1)
          }
        }
        fireDirect(s, 'pyroblast', PYRO_COEFF * mult)
      },
    },
    {
      id: 'fire_blast',
      name: 'Fire Blast',
      icon: 'spell_fire_fireball',
      spellId: 108853,
      cooldown: 12,
      charges: 3,
      offGcd: true, // castable while casting, like in game
      onResolve: (s) => fireDirect(s, 'fire_blast', FIRE_BLAST_COEFF, { guaranteedCrit: true }),
    },
    {
      id: 'phoenix_flames',
      name: 'Phoenix Flames',
      icon: 'artifactability_firemage_phoenixbolt',
      spellId: 257541,
      cooldown: 25,
      charges: 2,
      onResolve: (s) => fireDirect(s, 'phoenix_flames', PHOENIX_COEFF, { guaranteedCrit: true }),
    },
    {
      id: 'scorch',
      name: 'Scorch',
      icon: 'spell_fire_soulburn',
      spellId: 2948,
      castTime: 1.5,
      onResolve: (s) => fireDirect(s, 'scorch', SCORCH_COEFF),
    },
    {
      id: 'combustion',
      name: 'Combustion',
      icon: 'spell_fire_sealoffire',
      spellId: 190319,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => s.applyAura('player', 'combustion'),
    },
  ],

  actionBar: [
    'fireball', 'pyroblast', 'fire_blast', 'phoenix_flames', 'scorch', 'combustion',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'pyroblast': return s.auraRemains('player', 'hot_streak') > 0
      case 'fire_blast': return s.auraRemains('player', 'heating_up') > 0
      case 'phoenix_flames': return s.chargesOf('phoenix_flames') === 2
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'combustion', text: 'Off-GCD, with Heating Up or Hot Streak rolling', when: s => s.cooldownRemains('combustion') === 0 && (s.auraRemains('player', 'heating_up') > 0 || s.auraRemains('player', 'hot_streak') > 0) },
    { abilityId: 'pyroblast', text: 'Hot Streak — never hard-cast', when: s => s.auraRemains('player', 'hot_streak') > 0 },
    { abilityId: 'fire_blast', text: 'Convert Heating Up → Hot Streak (guaranteed crit); dump inside Combustion', when: s => s.auraRemains('player', 'heating_up') > 0 && s.chargesOf('fire_blast') > 0 },
    { abilityId: 'phoenix_flames', text: 'Inside Combustion once Fire Blasts run dry; never sit at 2 charges', when: s => s.chargesOf('phoenix_flames') === 2 },
    { abilityId: 'scorch', text: 'Combustion filler (fast enough to keep the crit chain alive) / movement' },
    { abilityId: 'fireball', text: 'Filler outside Combustion — always be casting' },
  ],

  policy: (s) => {
    const hs = s.auraRemains('player', 'hot_streak') > 0
    const hu = s.auraRemains('player', 'heating_up') > 0
    const comb = s.auraRemains('player', 'combustion') > 0
    const combCd = s.cooldownRemains('combustion')

    if (combCd === 0 && (hs || hu)) return 'combustion'
    if (hs) return 'pyroblast'
    if (comb) {
      if (s.chargesOf('fire_blast') > 0) return 'fire_blast'
      if (s.chargesOf('phoenix_flames') > 0) return 'phoenix_flames'
      return 'scorch'
    }
    if (hu && s.chargesOf('fire_blast') > 0 && combCd > 10) return 'fire_blast'
    if (s.chargesOf('phoenix_flames') === 2 && combCd > 20) return 'phoenix_flames'
    return 'fireball'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const converters = ['fire_blast', 'phoenix_flames']
    const fillers = ['fireball', 'scorch']
    const sets = [converters, fillers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
