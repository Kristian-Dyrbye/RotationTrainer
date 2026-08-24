import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Frost Mage — patch 12.1.0 (Midnight, Season 2), Spellslinger raid
 * single-target build. Modeled from the Wowhead/Icy Veins/Method 12.1
 * guides (verified 2026-08-24):
 * - https://www.wowhead.com/guide/classes/mage/frost/rotation-cooldowns-pve-dps
 * - https://www.icy-veins.com/wow/frost-mage-pve-dps-rotation-cooldowns-abilities
 * - https://www.method.gg/guides/frost-mage/playstyle-and-rotation
 *
 * 12.1 notes: Icy Veins (the cooldown) and Winter's Chill are REMOVED.
 * The core loop is the Freezing debuff (stacks to 20, built by Frostbolt /
 * Flurry / Ray of Frost / Frozen Orb) which Ice Lance Shatters — consuming
 * stacks for damage. Thermal Void is now a buff from consuming Brain Freeze:
 * the next Ice Lance Shatters 4 additional stacks. Fingers of Frost lets
 * Ice Lance deal max-Shatter damage without consuming Freezing. Ray of
 * Frost has 2 charges and turns into Comet Storm after the channel ends.
 * Resource model: Icicles (max 5) as the primary bar — they now generate
 * passively over time; at 5, Glacial Spike is available.
 * S2 tier: 2pc each Freezing stack Shattered has a 4% chance to generate an
 * Icicle, Glacial Spike +20% (in the coefficient); 4pc Glacial Spike has a
 * chance to rapidly generate 5 Icicles over 1s, Shatter damage +5% (folded
 * into the per-stack value).
 * APPROX-flagged: proc rates, base Shatter stack count (8), Freezing build
 * rates, splinter cadence, Ray-clipping at 2 Fingers of Frost (unmodeled —
 * the trainer never clips channels), shatters modeled as guaranteed crits.
 * Damage in SP units.
 */

const FB_COEFF = 0.86
const IL_COEFF = 0.50
const IL_PER_STACK = 0.12     // Shatter damage per Freezing stack, incl. S2 4pc +5%
const SHATTER_BASE = 8        // APPROX: stacks one Ice Lance can Shatter
const THERMAL_VOID_BONUS = 4  // 12.1: +4 stacks on the next Ice Lance
const FLURRY_HIT = 0.30       // 3 hits
const GS_COEFF = 4.4 * 1.2    // incl. S2 2pc +20%
const ORB_PULSE = 0.18        // 10 pulses over 10s
const RAY_TICK = 0.55         // 5 ticks
const COMET_HIT = 0.42        // 7 comets
const SPLINTER_COEFF = 0.14
const SPLINTERSTORM_COEFF = 1.35
const BF_CHANCE = 0.25        // APPROX: per Frostbolt
const FOF_CHANCE = 0.20       // APPROX: per Frostbolt
const FOF_ORB_CHANCE = 0.15   // APPROX: per orb pulse
const ICICLE_2PC_CHANCE = 0.04
const GS_4PC_CHANCE = 0.25    // APPROX: rapid 5-Icicle refill

/** Spellslinger: conjure Frost Splinters; every 8th triggers Splinterstorm */
function conjureSplinters(s: SimAPI, n: number) {
  for (let i = 0; i < n; i++) {
    s.schedule(s.time + 0.4, () => {
      s.damage('Frost Splinter', SPLINTER_COEFF, { tags: ['frost'] })
      s.data.splinters = (s.data.splinters ?? 0) + 1
      if (s.data.splinters >= 8) {
        s.data.splinters -= 8
        // Splinterstorm shatters on arrival (modeled as auto-crit)
        s.damage('Splinterstorm', SPLINTERSTORM_COEFF * s.stats.critMult, { canCrit: false, tags: ['frost'] })
      }
    })
  }
}

/** S2 2pc: each Freezing stack Shattered can generate an Icicle */
function shatterIcicles(s: SimAPI, consumed: number) {
  for (let i = 0; i < consumed; i++) {
    if (s.rng('icicle_2pc') < ICICLE_2PC_CHANCE) s.gain(1, 'freezing_shattered')
  }
}

export const frostMage: SpecConfig = {
  name: 'Frost Mage',
  specId: 'mage-frost',
  specIcon: 'spell_frost_frostbolt02',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/mage/frost/rotation-cooldowns-pve-dps',
    buildName: 'Frost Single Target — Spellslinger (Icy Veins 12.1 default)',
    heroTalent: 'Spellslinger',
    // Icy Veins "Frost Single Target" loadout, 12.1
    talentString: 'CAEAAAAAAAAAAAAAAAAAAAAAAYGGLzMzsMmZmYmZGjZMziZmZmZMDAAAMzMzyyMTbAAAAAAwGAbbjZmZwsNPgxMsAAAwMbAzADYGMMA',
    retrieved: '2026-08-24',
  },
  resourceName: 'Icicles',
  resourceMax: 5,
  startingResource: 0,

  auras: [
    { id: 'fingers_of_frost', name: 'Fingers of Frost', icon: 'ability_mage_wintersgrasp', duration: 15, maxStacks: 2 },
    { id: 'brain_freeze', name: 'Brain Freeze', icon: 'ability_mage_brainfreeze', duration: 15 },
    { id: 'thermal_void', name: 'Thermal Void', icon: 'spell_frost_coldhearted', duration: 15 },
    { id: 'freezing', name: 'Freezing', icon: 'spell_frost_frostshock', duration: 30, maxStacks: 20, debuff: true },
  ],

  abilities: [
    {
      id: 'frostbolt',
      name: 'Frostbolt',
      icon: 'spell_frost_frostbolt02',
      spellId: 116,
      castTime: 2.25,
      onResolve: (s) => {
        s.damage('frostbolt', FB_COEFF, { tags: ['frost'] })
        s.applyAura('target', 'freezing', { stacks: 2 })
        if (s.rng('brain_freeze') < BF_CHANCE) s.applyAura('player', 'brain_freeze')
        if (s.rng('fingers_of_frost') < FOF_CHANCE) s.applyAura('player', 'fingers_of_frost', { stacks: 1 })
        conjureSplinters(s, 1)
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
        if (shattered) conjureSplinters(s, 1) // Spellslinger: shattered lances splinter
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
        for (let i = 0; i < 3; i++) {
          s.schedule(s.time + i * 0.15, () => s.damage('flurry', FLURRY_HIT, { tags: ['frost'] }))
        }
        conjureSplinters(s, 1)
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
        conjureSplinters(s, 3)
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
      },
    },
  ],

  actionBar: [
    'frostbolt', 'ice_lance', 'flurry', 'glacial_spike',
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
      case 'ice_lance': return s.stacks('player', 'fingers_of_frost') > 0 || s.stacks('target', 'freezing') >= 6
      case 'flurry': return s.auraRemains('player', 'brain_freeze') > 0
      case 'glacial_spike': return s.insanity === 5
      case 'comet_storm': return (s.data.comet_ready ?? 0) > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'comet_storm', text: 'As soon as a Ray of Frost channel unlocks it', when: s => (s.data.comet_ready ?? 0) > 0 },
    { abilityId: 'flurry', text: 'Brain Freeze, if Thermal Void is not already up (free — grants Thermal Void)', when: s => s.auraRemains('player', 'brain_freeze') > 0 && s.auraRemains('player', 'thermal_void') === 0 },
    { abilityId: 'frozen_orb', text: 'On cooldown — builds Freezing and showers Fingers of Frost', when: s => s.cooldownRemains('frozen_orb') === 0 },
    { abilityId: 'ice_lance', text: 'With Fingers of Frost — max Shatter without spending Freezing', when: s => s.stacks('player', 'fingers_of_frost') > 0 },
    { abilityId: 'glacial_spike', text: 'Whenever 5 Icicles are up (they build passively)', when: s => s.insanity === 5 },
    { abilityId: 'ice_lance', text: 'At 6+ Freezing stacks — Shatter them', when: s => s.stacks('target', 'freezing') >= 6 },
    { abilityId: 'ray_of_frost', text: 'Keep charges rolling — the channel builds Freezing, then becomes Comet Storm', when: s => s.chargesOf('ray_of_frost') > 0 },
    { abilityId: 'flurry', text: 'Spare charge with no Brain Freeze — builds Freezing', when: s => s.chargesOf('flurry') > 0 },
    { abilityId: 'frostbolt', text: 'Filler — always be casting' },
  ],

  policy: (s) => {
    // never clip a Ray of Frost channel
    if (s.casting?.channel) return null
    const icicles = s.insanity
    const bf = s.auraRemains('player', 'brain_freeze') > 0
    const tv = s.auraRemains('player', 'thermal_void') > 0
    const fof = s.stacks('player', 'fingers_of_frost')
    const freezing = s.stacks('target', 'freezing')

    if ((s.data.comet_ready ?? 0) > 0) return 'comet_storm'
    if (bf && !tv) return 'flurry'
    if (s.cooldownRemains('frozen_orb') === 0) return 'frozen_orb'
    if (fof > 0) return 'ice_lance'
    if (icicles === 5) return 'glacial_spike'
    if (freezing >= 6) return 'ice_lance'
    if (s.chargesOf('ray_of_frost') > 0) return 'ray_of_frost'
    if (s.chargesOf('flurry') > 0 && !bf) return 'flurry'
    return 'frostbolt'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const shatterSpenders = ['ice_lance', 'glacial_spike']
    const freezingBuilders = ['flurry', 'frostbolt', 'ray_of_frost']
    const sets = [shatterSpenders, freezingBuilders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
