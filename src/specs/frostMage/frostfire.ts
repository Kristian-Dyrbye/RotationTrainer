import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Frost Mage — patch 12.1.0 (Midnight, Season 2), Frostfire raid ST build
 * (alternate to the default Spellslinger build in spec.ts). Modeled from
 * the Wowhead/Icy Veins/Method 12.1 guides (verified 2026-08-24):
 * - https://www.wowhead.com/guide/classes/mage/frost/rotation-cooldowns-pve-dps
 * - https://www.icy-veins.com/wow/frost-mage-pve-dps-rotation-cooldowns-abilities
 * - https://www.method.gg/guides/frost-mage/playstyle-and-rotation
 *
 * Shares the 12.1 Frost core with the base file: Freezing debuff stacks +
 * Shatter via Ice Lance, Thermal Void buff from Brain Freeze Flurries,
 * Ray of Frost → Comet Storm, passive Icicles feeding Glacial Spike.
 *
 * Frostfire in Midnight was redesigned: Excess Frost / Excess Fire /
 * Frostfire Mastery are removed. What it plays like now (Method + Icy
 * Veins rows, wowcarry's tree review):
 * - Frostbolt becomes Frostfire Bolt; Frostfire spells have a 10% chance
 *   to grant Frostfire Empowerment: the next Frostfire Bolt is instant and
 *   deals 60% more damage (its AoE explosion is dropped on ST). Severe
 *   Temperatures lets it stack (modeled: 2, APPROX); Thermal Conditioning
 *   trims the cast time.
 * - Flash Freezeburn (capstone): Glacial Spike hits harder, explodes for
 *   part of its damage, and grants Frostfire Empowerment — so Glacial
 *   Spike is the top of the priority.
 * - Heat Sink: Flurry deals Frostfire damage and hits harder.
 * - Isothermic Core: Comet Storm calls down a Meteor.
 * - Frostfire Infusion: chance to fire an extra Frostfire Bolt that can
 *   grant Brain Freeze.
 * - Ice Lance spends Freezing only at 12+ stacks (vs 6 on Spellslinger),
 *   or at 2 Fingers of Frost; no Splinters/Splinterstorm (Spellslinger).
 * S2 tier: 2pc each Freezing stack Shattered has a 4% chance to generate
 * an Icicle, Glacial Spike +20% (in the coefficient); 4pc Glacial Spike
 * can rapidly generate 5 Icicles, Shatter damage +5% (folded in).
 * Icy Veins' 12.1 builds page publishes export strings only for its
 * default (Spellslinger) loadouts, so talentString is omitted.
 * APPROX-flagged: proc rates, base Shatter stack count (8), Freezing build
 * rates, Empowerment stack cap, Flash Freezeburn explosion + Isothermic
 * Meteor coefficients, shatters modeled as guaranteed crits. Damage in SP
 * units.
 */

const FFB_COEFF = 0.86
const FFB_CAST = 2.0          // Thermal Conditioning: reduced cast time
const EMPOWERED_MULT = 1.6    // 12.1: Frostfire Empowerment +60%
const EMPOWER_CHANCE = 0.10   // 12.1: 10% per Frostfire spell
const INFUSION_CHANCE = 0.15  // APPROX: Frostfire Infusion extra bolt
const INFUSION_COEFF = 0.45   // APPROX
const INFUSION_BF_CHANCE = 0.10 // "small chance" to grant Brain Freeze
const IL_COEFF = 0.50
const IL_PER_STACK = 0.12     // Shatter damage per Freezing stack, incl. S2 4pc +5%
const SHATTER_BASE = 8        // APPROX: stacks one Ice Lance can Shatter
const THERMAL_VOID_BONUS = 4  // 12.1: +4 stacks on the next Ice Lance
const FLURRY_HIT = 0.30 * 1.3 // 3 hits, incl. Heat Sink (+30%, APPROX)
const GS_COEFF = 4.4 * 1.2 * 1.15 // incl. S2 2pc +20% and Flash Freezeburn (APPROX)
const GS_BURST_PCT = 0.25     // APPROX: Flash Freezeburn explosion
const ORB_PULSE = 0.18        // 10 pulses over 10s
const RAY_TICK = 0.55         // 5 ticks
const COMET_HIT = 0.42        // 7 comets
const METEOR_COEFF = 1.0      // APPROX: Isothermic Core Meteor
const BF_CHANCE = 0.25        // APPROX: per Frostfire Bolt
const FOF_CHANCE = 0.20       // APPROX: per Frostfire Bolt
const FOF_ORB_CHANCE = 0.15   // APPROX: per orb pulse
const ICICLE_2PC_CHANCE = 0.04
const GS_4PC_CHANCE = 0.25    // APPROX: rapid 5-Icicle refill

/** S2 2pc: each Freezing stack Shattered can generate an Icicle */
function shatterIcicles(s: SimAPI, consumed: number) {
  for (let i = 0; i < consumed; i++) {
    if (s.rng('icicle_2pc') < ICICLE_2PC_CHANCE) s.gain(1, 'freezing_shattered')
  }
}

/** Frostfire spells have a 10% chance to grant Frostfire Empowerment */
function rollEmpowerment(s: SimAPI) {
  if (s.rng('ff_empower') < EMPOWER_CHANCE) s.applyAura('player', 'frostfire_empowerment', { stacks: 1 })
}

export const frostMageFrostfire: SpecConfig = {
  name: 'Frost Mage',
  specId: 'mage-frost',
  specIcon: 'spell_frost_frostbolt02',
  buildId: 'frostfire',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/mage/frost/rotation-cooldowns-pve-dps',
    buildName: 'Frost Raid — Frostfire (Icy Veins/Method 12.1 alternate)',
    heroTalent: 'Frostfire',
    // Icy Veins' 12.1 builds page publishes export strings only for its
    // Spellslinger defaults — no Frostfire string, so none is quoted here.
    retrieved: '2026-08-24',
  },
  resourceName: 'Icicles',
  resourceMax: 5,
  startingResource: 0,

  auras: [
    { id: 'fingers_of_frost', name: 'Fingers of Frost', icon: 'ability_mage_wintersgrasp', duration: 15, maxStacks: 2 },
    { id: 'brain_freeze', name: 'Brain Freeze', icon: 'ability_mage_brainfreeze', duration: 15 },
    { id: 'thermal_void', name: 'Thermal Void', icon: 'spell_frost_coldhearted', duration: 15 },
    { id: 'frostfire_empowerment', name: 'Frostfire Empowerment', icon: 'spell_firefrost-orb', duration: 20, maxStacks: 2 },
    { id: 'freezing', name: 'Freezing', icon: 'spell_frost_frostshock', duration: 30, maxStacks: 20, debuff: true },
  ],

  abilities: [
    {
      id: 'frostfire_bolt',
      name: 'Frostfire Bolt',
      icon: 'ability_mage_frostfirebolt',
      spellId: 431044,
      castTime: FFB_CAST,
      // Frostfire Empowerment: the next Frostfire Bolt is instant
      castTimeMod: (s, base) => (s.stacks('player', 'frostfire_empowerment') > 0 ? 0 : base),
      onResolve: (s) => {
        const empowered = s.stacks('player', 'frostfire_empowerment') > 0
        if (empowered) s.consumeStack('player', 'frostfire_empowerment')
        s.damage('frostfire_bolt', FFB_COEFF * (empowered ? EMPOWERED_MULT : 1), { tags: ['frost'] })
        s.applyAura('target', 'freezing', { stacks: 2 })
        if (s.rng('brain_freeze') < BF_CHANCE) s.applyAura('player', 'brain_freeze')
        if (s.rng('fingers_of_frost') < FOF_CHANCE) s.applyAura('player', 'fingers_of_frost', { stacks: 1 })
        // Frostfire Infusion: chance to fire a bonus Frostfire Bolt
        if (s.rng('infusion') < INFUSION_CHANCE) {
          s.schedule(s.time + 0.4, () => {
            s.damage('Frostfire Infusion', INFUSION_COEFF, { tags: ['frost'] })
            if (s.rng('infusion_bf') < INFUSION_BF_CHANCE) s.applyAura('player', 'brain_freeze')
          })
        }
        rollEmpowerment(s)
      },
    },
    {
      id: 'ice_lance',
      name: 'Ice Lance',
      icon: 'spell_frost_frostblast',
      spellId: 30455,
      onResolve: (s) => {
        const tv = s.auraRemains('player', 'thermal_void') > 0
        const cap = SHATTER_BASE + (tv ? THERMAL_VOID_BONUS : 0)
        if (tv) s.removeAura('player', 'thermal_void')
        const fof = s.stacks('player', 'fingers_of_frost') > 0
        let effStacks: number
        if (fof) {
          // Fingers of Frost: max-Shatter damage without consuming Freezing
          s.consumeStack('player', 'fingers_of_frost')
          effStacks = cap
        } else {
          const freezing = s.stacks('target', 'freezing')
          const consumed = Math.min(freezing, cap)
          for (let i = 0; i < consumed; i++) s.consumeStack('target', 'freezing')
          shatterIcicles(s, consumed)
          effStacks = consumed
        }
        const shattered = effStacks > 0
        const coeff = IL_COEFF * (1 + IL_PER_STACK * effStacks) * (shattered ? s.stats.critMult : 1)
        s.damage('ice_lance', coeff, { canCrit: !shattered, tags: ['frost'] })
      },
    },
    {
      id: 'flurry',
      name: 'Flurry',
      icon: 'spell_frost_iceshard',
      spellId: 44614,
      cooldown: 30,
      charges: 2,
      // Brain Freeze makes Flurry free (12.1: consuming it grants Thermal Void)
      noCooldownIf: (s) => s.auraRemains('player', 'brain_freeze') > 0,
      onResolve: (s) => {
        if (s.auraRemains('player', 'brain_freeze') > 0) {
          s.removeAura('player', 'brain_freeze')
          s.applyAura('player', 'thermal_void')
        }
        s.applyAura('target', 'freezing', { stacks: 5 })
        // Heat Sink: Flurry deals Frostfire damage and hits harder
        for (let i = 0; i < 3; i++) {
          s.schedule(s.time + i * 0.15, () => s.damage('flurry', FLURRY_HIT, { tags: ['frost'] }))
        }
        rollEmpowerment(s)
      },
    },
    {
      id: 'glacial_spike',
      name: 'Glacial Spike',
      icon: 'spell_frost_frozencore',
      spellId: 199786,
      castTime: 2.75,
      cost: 5,
      onResolve: (s) => {
        s.damage('glacial_spike', GS_COEFF, { tags: ['frost'] })
        // Flash Freezeburn: the Spike explodes on impact...
        s.damage('Glacial Spike burst', GS_COEFF * GS_BURST_PCT, { tags: ['frost'] })
        // ...and grants Frostfire Empowerment
        s.applyAura('player', 'frostfire_empowerment', { stacks: 1 })
        // S2 4pc: chance to rapidly refill the Icicle bar
        if (s.rng('gs_4pc') < GS_4PC_CHANCE) {
          for (let i = 1; i <= 5; i++) s.schedule(s.time + i * 0.2, () => s.gain(1, 'gs_4pc'))
        }
      },
    },
    {
      id: 'frozen_orb',
      name: 'Frozen Orb',
      icon: 'spell_frost_frozenorb',
      spellId: 84714,
      cooldown: 60,
      onResolve: (s) => {
        s.applyAura('player', 'fingers_of_frost', { stacks: 1 })
        for (let i = 0; i < 10; i++) {
          s.schedule(s.time + 0.5 + i, () => {
            s.damage('frozen_orb', ORB_PULSE, { tags: ['frost'] })
            s.applyAura('target', 'freezing', { stacks: 1 })
            if (s.rng('fof_orb') < FOF_ORB_CHANCE) s.applyAura('player', 'fingers_of_frost', { stacks: 1 })
          })
        }
      },
    },
    {
      id: 'ray_of_frost',
      name: 'Ray of Frost',
      icon: 'ability_mage_rayoffrost',
      spellId: 205021,
      cooldown: 60,
      charges: 2,
      channel: {
        duration: 4,
        ticks: 5,
        hasted: true,
        onTick: (s, i) => {
          s.damage('ray_of_frost', RAY_TICK, { tags: ['frost'] })
          s.applyAura('target', 'freezing', { stacks: 1 })
          // the button turns into Comet Storm once the channel finishes
          if (i === 5) s.data.comet_ready = 1
        },
      },
      onResolve: () => {},
    },
    {
      id: 'comet_storm',
      name: 'Comet Storm',
      icon: 'spell_mage_cometstorm',
      spellId: 153595,
      usable: (s) => ((s.data.comet_ready ?? 0) > 0 ? true : 'requires a finished Ray of Frost'),
      onResolve: (s) => {
        s.data.comet_ready = 0
        // comets Shatter too: they chew through Freezing stacks as they land
        for (let i = 0; i < 7; i++) {
          s.schedule(s.time + 0.3 + i * 0.25, () => {
            const frozen = s.stacks('target', 'freezing') > 0
            if (frozen) {
              s.consumeStack('target', 'freezing')
              shatterIcicles(s, 1)
            }
            const coeff = COMET_HIT * (frozen ? s.stats.critMult : 1)
            s.damage('comet_storm', coeff, { canCrit: !frozen, tags: ['frost'] })
          })
        }
        // Isothermic Core: Comet Storm calls down a Meteor
        s.schedule(s.time + 1, () => s.damage('meteor', METEOR_COEFF, { tags: ['fire'] }))
      },
    },
  ],

  actionBar: [
    'frostfire_bolt', 'ice_lance', 'flurry', 'glacial_spike',
    'frozen_orb', 'ray_of_frost', 'comet_storm',
  ],

  onCombatStart: (s) => {
    // 12.1 Icicles generate passively — one every few seconds
    const loop = () => {
      s.gain(1, 'icicle_passive')
      s.schedule(s.time + 3 * s.hasteMult(), loop)
    }
    s.schedule(s.time + 3 * s.hasteMult(), loop)
  },

  glows: (s, id) => {
    switch (id) {
      case 'ice_lance': return s.stacks('player', 'fingers_of_frost') >= 2 || s.stacks('target', 'freezing') >= 12
      case 'flurry': return s.auraRemains('player', 'brain_freeze') > 0
      case 'glacial_spike': return s.insanity === 5
      case 'comet_storm': return (s.data.comet_ready ?? 0) > 0
      case 'frostfire_bolt': return s.stacks('player', 'frostfire_empowerment') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'glacial_spike', text: 'Top priority at 5 Icicles — Flash Freezeburn: explodes and grants Frostfire Empowerment', when: s => s.insanity === 5 },
    { abilityId: 'comet_storm', text: 'As soon as a Ray of Frost channel unlocks it — a Meteor falls with it', when: s => (s.data.comet_ready ?? 0) > 0 },
    { abilityId: 'flurry', text: 'Brain Freeze, if Thermal Void is not already up (free — grants Thermal Void)', when: s => s.auraRemains('player', 'brain_freeze') > 0 && s.auraRemains('player', 'thermal_void') === 0 },
    { abilityId: 'ice_lance', text: 'At 2 stacks of Fingers of Frost — never overcap them', when: s => s.stacks('player', 'fingers_of_frost') >= 2 },
    { abilityId: 'frozen_orb', text: 'On cooldown — builds Freezing and showers Fingers of Frost', when: s => s.cooldownRemains('frozen_orb') === 0 },
    { abilityId: 'ice_lance', text: 'With Fingers of Frost while Thermal Void is loaded', when: s => s.stacks('player', 'fingers_of_frost') > 0 && s.auraRemains('player', 'thermal_void') > 0 },
    { abilityId: 'ice_lance', text: 'At 12+ Freezing stacks (Frostfire waits longer than Spellslinger)', when: s => s.stacks('target', 'freezing') >= 12 },
    { abilityId: 'ray_of_frost', text: 'Keep charges rolling — the channel builds Freezing, then becomes Comet Storm', when: s => s.chargesOf('ray_of_frost') > 0 },
    { abilityId: 'flurry', text: 'Spare charge with no Brain Freeze — builds Freezing (Heat Sink: Frostfire hits)', when: s => s.chargesOf('flurry') > 0 },
    { abilityId: 'frostfire_bolt', text: 'Filler — instant and +60% with Frostfire Empowerment' },
  ],

  policy: (s) => {
    // never clip a Ray of Frost channel
    if (s.casting?.channel) return null
    const icicles = s.insanity
    const bf = s.auraRemains('player', 'brain_freeze') > 0
    const tv = s.auraRemains('player', 'thermal_void') > 0
    const fof = s.stacks('player', 'fingers_of_frost')
    const freezing = s.stacks('target', 'freezing')

    if (icicles === 5) return 'glacial_spike'
    if ((s.data.comet_ready ?? 0) > 0) return 'comet_storm'
    if (bf && !tv) return 'flurry'
    if (fof >= 2) return 'ice_lance'
    if (s.cooldownRemains('frozen_orb') === 0) return 'frozen_orb'
    if (fof > 0 && tv) return 'ice_lance'
    if (freezing >= 12) return 'ice_lance'
    if (s.chargesOf('ray_of_frost') > 0) return 'ray_of_frost'
    if (s.chargesOf('flurry') > 0 && !bf) return 'flurry'
    return 'frostfire_bolt'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const shatterSpenders = ['ice_lance', 'glacial_spike']
    const freezingBuilders = ['flurry', 'frostfire_bolt', 'ray_of_frost']
    const sets = [shatterSpenders, freezingBuilders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
