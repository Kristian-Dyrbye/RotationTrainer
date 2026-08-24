import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Frost Mage — patch 12.1.0 (Midnight, Season 2), Spellslinger raid ST
 * Glacial Spike build (Icy Veins default). Built from the simc `midnight`
 * APL/source and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Icicles (max 5) as the primary bar — with Glacial Spike
 * talented they are only released by GS. Mana is never constraining on a
 * training dummy and is not modeled.
 * Talent assumptions: Glacial Spike, Fingers of Frost, Brain Freeze (Flurry
 * gated on it, 12.1 style), Splintering Sorcery (Spellslinger),
 * Apex: Eternal Winter 3/3 (Glacial Spike extends Icy Veins).
 * S2 tier: 2pc splinter damage folded into the coefficient; 4pc Splinterstorm
 * grants Fingers of Frost. APPROX-flagged: proc rates, splinter cadence,
 * shatter modeled as a guaranteed crit. Damage in SP units.
 */

const FB_COEFF = 0.86
const IL_COEFF = 0.55
const IL_FROZEN_MULT = 3     // Ice Lance triple damage vs frozen
const FLURRY_HIT = 0.30      // 3 hits
const GS_COEFF = 4.4
const ORB_PULSE = 0.18       // 10 pulses over 10s
const COMET_HIT = 0.42       // 7 comets
const SPLINTER_COEFF = 0.14  // incl. S2 2pc +25%
const SPLINTERSTORM_COEFF = 1.35
const IV_HASTE = 0.30
const BF_CHANCE = 0.30       // APPROX: per Frostbolt
const FOF_CHANCE = 0.15      // APPROX: per Frostbolt
const FOF_ORB_CHANCE = 0.15  // APPROX: per orb pulse

/** any spell hit eats a Winter's Chill stack and shatters (guaranteed crit) */
function consumeWintersChill(s: SimAPI): boolean {
  if (s.stacks('target', 'winters_chill') > 0) {
    s.consumeStack('target', 'winters_chill')
    return true
  }
  return false
}

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
        s.applyAura('player', 'fingers_of_frost', { stacks: 1 }) // S2 4pc
      }
    })
  }
}

export const frostMage: SpecConfig = {
  name: 'Frost Mage',
  specId: 'mage-frost',
  specIcon: 'spell_frost_frostbolt02',
  resourceName: 'Icicles',
  resourceMax: 5,
  startingResource: 0,

  auras: [
    { id: 'fingers_of_frost', name: 'Fingers of Frost', icon: 'ability_mage_wintersgrasp', duration: 15, maxStacks: 2 },
    { id: 'brain_freeze', name: 'Brain Freeze', icon: 'ability_mage_brainfreeze', duration: 15 },
    { id: 'winters_chill', name: "Winter's Chill", icon: 'spell_frost_frostward', duration: 6, maxStacks: 2, debuff: true },
    {
      id: 'icy_veins', name: 'Icy Veins', icon: 'spell_frost_coldhearted', duration: 20,
      // Spellslinger: Icy Veins showers extra splinters while it runs
      tick: { interval: 2.5, hasted: false, onTick: s => conjureSplinters(s, 1) },
    },
  ],

  abilities: [
    {
      id: 'frostbolt',
      name: 'Frostbolt',
      icon: 'spell_frost_frostbolt02',
      spellId: 116,
      castTime: 2.25,
      onResolve: (s) => {
        s.gain(1, 'frostbolt')
        const shattered = consumeWintersChill(s)
        s.damage('frostbolt', FB_COEFF * (shattered ? s.stats.critMult : 1), { canCrit: !shattered, tags: ['frost'] })
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
        let shattered = consumeWintersChill(s)
        if (!shattered && s.stacks('player', 'fingers_of_frost') > 0) {
          s.consumeStack('player', 'fingers_of_frost')
          shattered = true
        }
        const coeff = IL_COEFF * (shattered ? IL_FROZEN_MULT * s.stats.critMult : 1)
        s.damage('ice_lance', coeff, { canCrit: !shattered, tags: ['frost'] })
        if (shattered) conjureSplinters(s, 1) // Spellslinger: shattered lances splinter
      },
    },
    {
      id: 'flurry',
      name: 'Flurry',
      icon: 'spell_frost_iceshard',
      spellId: 44614,
      cooldown: 25,
      usable: (s) => (s.auraRemains('player', 'brain_freeze') > 0 ? true : 'requires Brain Freeze'),
      onResolve: (s) => {
        s.removeAura('player', 'brain_freeze')
        s.gain(1, 'flurry')
        s.applyAura('target', 'winters_chill', { stacks: 2 })
        for (let i = 0; i < 3; i++) {
          s.schedule(s.time + i * 0.15, () => s.damage('flurry', FLURRY_HIT, { tags: ['frost'] }))
        }
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
        const shattered = consumeWintersChill(s)
        s.damage('glacial_spike', GS_COEFF * (shattered ? s.stats.critMult : 1), { canCrit: !shattered, tags: ['frost'] })
        conjureSplinters(s, 3)
        // Apex: Eternal Winter — each GS extends Icy Veins 2s, 5 times
        const iv = s.aura('player', 'icy_veins')
        if (iv && (iv.data.ext ?? 0) < 5) {
          iv.data.ext = (iv.data.ext ?? 0) + 1
          s.extendAura('player', 'icy_veins', 2)
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
            if (s.rng('fof_orb') < FOF_ORB_CHANCE) s.applyAura('player', 'fingers_of_frost', { stacks: 1 })
          })
        }
      },
    },
    {
      id: 'comet_storm',
      name: 'Comet Storm',
      icon: 'spell_mage_cometstorm',
      spellId: 153595,
      cooldown: 30,
      onResolve: (s) => {
        for (let i = 0; i < 7; i++) {
          s.schedule(s.time + 0.3 + i * 0.25, () => s.damage('comet_storm', COMET_HIT, { tags: ['frost'] }))
        }
      },
    },
    {
      id: 'icy_veins',
      name: 'Icy Veins',
      icon: 'spell_frost_coldhearted',
      spellId: 12472,
      cooldown: 120,
      onResolve: (s) => s.applyAura('player', 'icy_veins'),
    },
  ],

  actionBar: [
    'frostbolt', 'ice_lance', 'flurry', 'glacial_spike',
    'frozen_orb', 'comet_storm', 'icy_veins',
  ],

  hasteMod: (s) => (s.auraRemains('player', 'icy_veins') > 0 ? IV_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'ice_lance': return s.stacks('player', 'fingers_of_frost') > 0 || s.stacks('target', 'winters_chill') > 0
      case 'flurry': return s.auraRemains('player', 'brain_freeze') > 0
      case 'glacial_spike': return s.insanity === 5
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'icy_veins', text: 'On cooldown (Glacial Spikes extend it — Apex)', when: s => s.cooldownRemains('icy_veins') === 0 },
    { abilityId: 'frozen_orb', text: 'On cooldown — showers Fingers of Frost', when: s => s.cooldownRemains('frozen_orb') === 0 },
    { abilityId: 'comet_storm', text: 'On cooldown', when: s => s.cooldownRemains('comet_storm') === 0 },
    { abilityId: 'flurry', text: 'Brain Freeze at 5 Icicles — Shatter the Spike', when: s => s.insanity === 5 && s.auraRemains('player', 'brain_freeze') > 0 && s.stacks('target', 'winters_chill') === 0 },
    { abilityId: 'glacial_spike', text: 'At 5 Icicles, into Winter’s Chill if you can', when: s => s.insanity === 5 },
    { abilityId: 'flurry', text: 'Brain Freeze while pooling (≤2 Icicles) — combo into Ice Lance' },
    { abilityId: 'ice_lance', text: 'Spend Fingers of Frost / Winter’s Chill charges', when: s => s.stacks('player', 'fingers_of_frost') > 0 || s.stacks('target', 'winters_chill') > 0 },
    { abilityId: 'frostbolt', text: 'Filler — always be casting' },
  ],

  policy: (s) => {
    const icicles = s.insanity
    const bf = s.auraRemains('player', 'brain_freeze') > 0
    const wc = s.stacks('target', 'winters_chill')
    const fof = s.stacks('player', 'fingers_of_frost')
    const flurryReady = bf && s.cooldownRemains('flurry') === 0

    if (s.cooldownRemains('icy_veins') === 0) return 'icy_veins'
    if (s.cooldownRemains('frozen_orb') === 0) return 'frozen_orb'
    if (s.cooldownRemains('comet_storm') === 0) return 'comet_storm'

    if (icicles === 5) {
      // shatter combo: Flurry first, Glacial Spike into Winter's Chill
      if (flurryReady && wc === 0) return 'flurry'
      return 'glacial_spike'
    }
    // low on icicles: spend Brain Freeze on a Flurry -> Ice Lance combo,
    // otherwise hold it for the Glacial Spike shatter
    if (flurryReady && wc === 0 && icicles <= 2) return 'flurry'
    if (wc > 0 || fof > 0) return 'ice_lance'
    return 'frostbolt'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const shatterSpenders = ['ice_lance', 'glacial_spike']
    const cds = ['frozen_orb', 'comet_storm']
    const sets = [shatterSpenders, cds]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
