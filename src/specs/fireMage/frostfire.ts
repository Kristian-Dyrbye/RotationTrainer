import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Fire Mage — patch 12.1.0 (Midnight, Season 2), Frostfire raid ST build
 * (alternate to the default Sunfury build in spec.ts). Modeled from the
 * Wowhead/Icy Veins/Method 12.1 guides (verified 2026-08-24):
 * - https://www.wowhead.com/guide/classes/mage/fire/rotation-cooldowns-pve-dps
 * - https://www.icy-veins.com/wow/fire-mage-pve-dps-rotation-cooldowns-abilities
 * - https://www.method.gg/guides/fire-mage/talents
 *
 * Frostfire in Midnight was redesigned: Excess Frost / Excess Fire /
 * Frostfire Mastery are removed. What remains (per Method's 12.1 talents
 * page + Icy Veins notes):
 * - Frostfire Bolt replaces Fireball (Frostfire damage). Frostfire spells
 *   have a 10% chance to grant Frostfire Empowerment: the next Frostfire
 *   Bolt is instant, deals 60% more damage, and explodes for 60% of its
 *   damage (ST: the explosion is dropped). Severe Temperatures lets
 *   Empowerment stack (modeled: 2, APPROX) — it is the resource bar here.
 * - Meteor deals 25% more damage and grants Frostfire Empowerment;
 *   Isothermic Core pairs it with a Comet Storm ("Meteor / Comet Storm
 *   combo" — Method).
 * - Heat Sink: Fire Blast deals Frostfire damage, +30%.
 * - Duality: Pyroblast has a 25% chance to fire a Glacial Spike.
 * - Molten Chill / Elemental Conduit: Frostfire spells apply Ignite at +10%
 *   effectiveness and grant 8% Haste (both modeled).
 * - Scorch is a pure mobility tool as Frostfire (Icy Veins) — off the bar.
 * - No Spellfire Spheres / Burden of Power / Hyperthermia / Arcane Phoenix —
 *   those are Sunfury. Combustion is a flat window. Phoenix Flames is
 *   removed from Fire in Midnight; Fire Blast is the only Heating Up
 *   converter.
 * Crit engine: Heating Up → Hot Streak with expected-value damage plus an
 * explicit crit roll; Combustion and Fire Blast force it. Ignite is a single
 * banked DoT (simc-style, APPROX). Pyroclasm procs from consuming Hot
 * Streak (spec talent, kept for both heroes).
 * S2 tier: 2pc Pyroclasm Pyroblasts always crit; 4pc Pyroclasm damage +20%
 * and Pyroblast cast time -20% (both modeled).
 * Icy Veins publishes no Frostfire export string on its 12.1 builds page
 * (Sunfury only), so talentString is omitted. Note both Icy Veins and
 * Method consider Frostfire undertuned vs Sunfury in 12.1 — modeled as the
 * published alternate all the same.
 * APPROX-flagged: Empowerment proc/stack numbers, Duality Glacial Spike and
 * Comet Storm coefficients, Pyroclasm rate. Damage in SP units.
 */

const FFB_COEFF = 1.05
const EMPOWERED_MULT = 1.6       // 12.1: Frostfire Empowerment +60%
const EMPOWER_CHANCE = 0.10      // 12.1: 10% per Frostfire spell
const PYRO_COEFF = 2.45
const PYRO_CAST_MULT = 0.8       // S2 4pc: Pyroblast cast time -20%
const PYROCLASM_MULT = 1.6       // APPROX: Pyroclasm incl. 4pc +20%
const PYROCLASM_CHANCE = 0.12    // APPROX: per Hot Streak consumed
const FIRE_BLAST_COEFF = 0.83
const HEAT_SINK_MULT = 1.3       // 12.1: Heat Sink — Fire Blast +30%
const METEOR_COEFF = 2.2 * 1.25  // 12.1: Meteor +25% as Frostfire
const COMET_HIT = 0.32           // APPROX: Isothermic Core comets (7)
const GS_COEFF = 1.6             // APPROX: Duality Glacial Spike
const GS_CHANCE = 0.25           // 12.1: per Pyroblast
const IGNITE_PCT = 0.30 * 1.1    // mastery stand-in, incl. Molten Chill +10%
const IGNITE_TICK_PCT = 0.20
const CONDUIT_HASTE = 0.08       // 12.1: Elemental Conduit
const COMBUSTION_DUR = 10

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

/** Frostfire spells have a 10% chance to grant Frostfire Empowerment */
function rollEmpowerment(s: SimAPI) {
  if (s.rng('ff_empower') < EMPOWER_CHANCE) s.gain(1, 'frostfire_empowerment')
}

export const fireMageFrostfire: SpecConfig = {
  name: 'Fire Mage',
  specId: 'mage-fire',
  specIcon: 'spell_fire_firebolt02',
  buildId: 'frostfire',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/mage/fire/rotation-cooldowns-pve-dps',
    buildName: 'Fire Raid — Frostfire (Icy Veins/Method 12.1 alternate)',
    heroTalent: 'Frostfire',
    // Icy Veins' 12.1 builds page publishes export strings only for Sunfury —
    // no Frostfire string is published, so none is quoted here.
    retrieved: '2026-08-24',
  },
  // Severe Temperatures: Frostfire Empowerment stacks — shown as the bar
  resourceName: 'Frostfire Empowerment',
  resourceMax: 2,
  startingResource: 0,

  auras: [
    { id: 'heating_up', name: 'Heating Up', icon: 'ability_mage_hotstreak', duration: 10 },
    { id: 'hot_streak', name: 'Hot Streak!', icon: 'ability_mage_hotstreak', duration: 15 },
    { id: 'pyroclasm', name: 'Pyroclasm', icon: 'spell_shaman_lavasurge', duration: 30 },
    { id: 'combustion', name: 'Combustion', icon: 'spell_fire_sealoffire', duration: COMBUSTION_DUR },
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
      id: 'frostfire_bolt',
      name: 'Frostfire Bolt',
      icon: 'ability_mage_frostfirebolt',
      spellId: 431044,
      castTime: 2.25,
      // Frostfire Empowerment: the next Frostfire Bolt is instant
      castTimeMod: (s, base) => (s.insanity > 0 ? 0 : base),
      onResolve: (s) => {
        const empowered = s.insanity > 0
        if (empowered) s.spend(1)
        fireDirect(s, 'frostfire_bolt', FFB_COEFF * (empowered ? EMPOWERED_MULT : 1))
        rollEmpowerment(s)
      },
    },
    {
      id: 'pyroblast',
      name: 'Pyroblast',
      icon: 'spell_fire_fireball02',
      spellId: 11366,
      castTime: 4.0,
      castTimeMod: (s, base) =>
        s.auraRemains('player', 'hot_streak') > 0 ? 0 : base * PYRO_CAST_MULT, // S2 4pc
      onResolve: (s) => {
        const hotStreak = s.auraRemains('player', 'hot_streak') > 0
        let mult = 1
        let forceCrit = false
        if (hotStreak) {
          s.removeAura('player', 'hot_streak')
          if (s.rng('pyroclasm') < PYROCLASM_CHANCE) s.applyAura('player', 'pyroclasm')
        } else if (s.auraRemains('player', 'pyroclasm') > 0) {
          // hardcast with Pyroclasm: S2 2pc guarantees the crit
          s.removeAura('player', 'pyroclasm')
          mult *= PYROCLASM_MULT
          forceCrit = true
        }
        fireDirect(s, 'pyroblast', PYRO_COEFF * mult, { guaranteedCrit: forceCrit })
        // Duality: Pyroblast has a 25% chance to fire a Glacial Spike
        if (s.rng('duality') < GS_CHANCE) {
          s.schedule(s.time + 0.4, () => s.damage('glacial_spike', GS_COEFF, { tags: ['frost'] }))
        }
      },
    },
    {
      id: 'fire_blast',
      name: 'Fire Blast',
      icon: 'spell_fire_fireball',
      spellId: 108853,
      cooldown: 10,
      charges: 3,
      offGcd: true, // castable while casting, like in game
      onResolve: (s) => {
        // Heat Sink: Fire Blast deals Frostfire damage, +30%
        fireDirect(s, 'fire_blast', FIRE_BLAST_COEFF * HEAT_SINK_MULT, { guaranteedCrit: true })
        rollEmpowerment(s)
      },
    },
    {
      id: 'meteor',
      name: 'Meteor',
      icon: 'spell_mage_meteor',
      spellId: 153561,
      cooldown: 45,
      onResolve: (s) => {
        s.schedule(s.time + 1, () => fireDirect(s, 'meteor', METEOR_COEFF, { noProc: true }))
        // Frostfire: Meteor grants Frostfire Empowerment...
        s.gain(1, 'frostfire_empowerment')
        // ...and Isothermic Core calls a Comet Storm down with it
        for (let i = 0; i < 7; i++) {
          s.schedule(s.time + 1.2 + i * 0.25, () => s.damage('comet_storm', COMET_HIT, { tags: ['frost'] }))
        }
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
        s.applyAura('player', 'combustion')
      },
    },
  ],

  actionBar: [
    'frostfire_bolt', 'pyroblast', 'fire_blast', 'meteor', 'combustion',
  ],

  hasteMod: () => CONDUIT_HASTE, // Elemental Conduit: +8% Haste

  glows: (s, id) => {
    switch (id) {
      case 'pyroblast': return s.auraRemains('player', 'hot_streak') > 0
        || s.auraRemains('player', 'pyroclasm') > 0
      case 'fire_blast': return s.auraRemains('player', 'heating_up') > 0
      case 'frostfire_bolt': return s.insanity > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'combustion', text: 'On cooldown (off-GCD) — everything crits inside', when: s => s.cooldownRemains('combustion') === 0 },
    { abilityId: 'meteor', text: 'On cooldown — grants Frostfire Empowerment, Comet Storm falls with it', when: s => s.cooldownRemains('meteor') === 0 },
    { abilityId: 'pyroblast', text: 'Instant with Hot Streak — never sit on it (can fire a Glacial Spike)', when: s => s.auraRemains('player', 'hot_streak') > 0 },
    { abilityId: 'fire_blast', text: 'Convert Heating Up → Hot Streak; dump inside Combustion, never overcap', when: s => s.auraRemains('player', 'heating_up') > 0 && s.chargesOf('fire_blast') > 0 },
    { abilityId: 'pyroblast', text: 'Hardcast with Pyroclasm (2pc: always crits, 4pc: 20% faster)', when: s => s.auraRemains('player', 'pyroclasm') > 0 && s.auraRemains('player', 'hot_streak') === 0 },
    { abilityId: 'frostfire_bolt', text: 'Instant with Frostfire Empowerment: +60% damage', when: s => s.insanity > 0 },
    { abilityId: 'frostfire_bolt', text: 'Filler — always be casting, chain into Pyroblast' },
  ],

  policy: (s) => {
    const hs = s.auraRemains('player', 'hot_streak') > 0
    const hu = s.auraRemains('player', 'heating_up') > 0
    const comb = s.auraRemains('player', 'combustion') > 0
    const combCd = s.cooldownRemains('combustion')

    if (combCd === 0) return 'combustion'
    if (s.cooldownRemains('meteor') === 0) return 'meteor'
    if (hs) return 'pyroblast'
    if (comb) {
      if (s.chargesOf('fire_blast') > 0) return 'fire_blast'
      return 'frostfire_bolt'
    }
    if (s.auraRemains('player', 'pyroclasm') > 0) return 'pyroblast'
    if (hu && s.chargesOf('fire_blast') > 0 && combCd > 10) return 'fire_blast'
    return 'frostfire_bolt'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const nukes = ['pyroblast', 'meteor']
    const converters = ['fire_blast', 'frostfire_bolt']
    const sets = [nukes, converters]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
