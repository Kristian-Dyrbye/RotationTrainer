import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Devastation Evoker — patch 12.1.0 (Midnight, Season 2), Flameshaper raid
 * ST build (Icy Veins default). Built from the simc `midnight` APL/source
 * and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Essence (max 5), 1 regenerated every 5s (hasted).
 * Essence Burst procs make Disintegrate free (consumed on its first tick).
 * Empowered spells (Fire Breath, Eternity Surge) are modeled at a fixed
 * full-empower cast time of 2.5s — APPROX, no empower-level choice in v1.
 * Talent assumptions: Flameshaper (Engulf, fans Fire Breath's flames),
 * Apex: Ruby Cataclysm 3/3 (Engulf extends Dragonrage 2s, 3 times).
 * S2 tier: 2pc Fire Breath dot +4s (folded into the 22s duration);
 * 4pc Shattering Star grants Essence Burst (Arcane Vigor folded in).
 * APPROX-flagged: proc rates, dot pacing, range-roll damage flattened to
 * mean coefficients. Damage in SP units.
 */

const LF_COEFF = 1.0
const AZ_COEFF = 0.55
const DISINT_TICK = 0.95      // 4 ticks over 3s
const FB_DIRECT = 1.5
const FB_TICK = 0.35          // every 2s over 22s
const ES_COEFF = 3.8
const STAR_COEFF = 1.0
const ENGULF_COEFF = 2.2
const ENGULF_DOT_MULT = 1.33  // Flameshaper: consumes the flames
const DR_MULT = 1.15
const STAR_AMP = 1.2
const EB_CHANCE = 0.35        // APPROX: Essence Burst per Living Flame

function ebUp(s: SimAPI): number {
  return s.stacks('player', 'essence_burst')
}

export const devastationEvoker: SpecConfig = {
  name: 'Devastation Evoker',
  specId: 'evoker-devastation',
  specIcon: 'classicon_evoker_devastation',
  resourceName: 'Essence',
  resourceMax: 5,
  startingResource: 3,

  onCombatStart: (s) => {
    const regen = () => {
      s.gain(1, 'essence_regen')
      s.schedule(s.time + 5 * s.hasteMult(), regen)
    }
    s.schedule(s.time + 5 * s.hasteMult(), regen)
  },

  auras: [
    { id: 'essence_burst', name: 'Essence Burst', icon: 'ability_evoker_essenceburst', duration: 15, maxStacks: 2 },
    {
      id: 'fire_breath_dot', name: 'Fire Breath', icon: 'ability_evoker_firebreath', duration: 22, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('fire_breath_dot', FB_TICK, { tags: ['fire'] }) },
    },
    { id: 'shattering_star', name: 'Shattering Star', icon: 'ability_evoker_chargedblast', duration: 4, debuff: true },
    {
      id: 'dragonrage', name: 'Dragonrage', icon: 'ability_evoker_dragonrage', duration: 18,
      // Animosity-style shower: a free Essence Burst every 3s while raging
      tick: { interval: 3, hasted: false, onTick: s => s.applyAura('player', 'essence_burst', { stacks: 1 }) },
    },
  ],

  abilities: [
    {
      id: 'living_flame',
      name: 'Living Flame',
      icon: 'ability_evoker_livingflame',
      spellId: 361469,
      castTime: 2.25,
      onResolve: (s) => {
        s.damage('living_flame', LF_COEFF, { tags: ['fire'] })
        if (s.rng('essence_burst') < EB_CHANCE) s.applyAura('player', 'essence_burst', { stacks: 1 })
      },
    },
    {
      id: 'azure_strike',
      name: 'Azure Strike',
      icon: 'ability_evoker_azurestrike',
      spellId: 362969,
      onResolve: (s) => s.damage('azure_strike', AZ_COEFF, { tags: ['arcane'] }),
    },
    {
      id: 'disintegrate',
      name: 'Disintegrate',
      icon: 'ability_evoker_disintegrate',
      spellId: 356995,
      cost: 3,
      costMod: (s) => (ebUp(s) > 0 ? 0 : 3),
      channel: {
        duration: 3,
        ticks: 4,
        hasted: true,
        onTick: (s, i) => {
          // an Essence Burst is consumed as the beam settles (first tick)
          if (i === 1 && ebUp(s) > 0) s.consumeStack('player', 'essence_burst')
          s.damage('disintegrate', DISINT_TICK, { tags: ['arcane'] })
        },
      },
      onResolve: () => {},
    },
    {
      id: 'fire_breath',
      name: 'Fire Breath',
      icon: 'ability_evoker_firebreath',
      spellId: 357208,
      castTime: 2.5, // APPROX: fixed full empower
      cooldown: 30,
      onResolve: (s) => {
        s.damage('fire_breath', FB_DIRECT, { tags: ['fire'] })
        s.applyAura('target', 'fire_breath_dot')
      },
    },
    {
      id: 'eternity_surge',
      name: 'Eternity Surge',
      icon: 'ability_evoker_eternitysurge',
      spellId: 359073,
      castTime: 2.5, // APPROX: fixed full empower
      cooldown: 30,
      onResolve: (s) => s.damage('eternity_surge', ES_COEFF, { tags: ['arcane'] }),
    },
    {
      id: 'shattering_star',
      name: 'Shattering Star',
      icon: 'ability_evoker_chargedblast',
      spellId: 370452,
      cooldown: 20,
      onResolve: (s) => {
        s.damage('shattering_star', STAR_COEFF, { tags: ['arcane'] })
        s.applyAura('target', 'shattering_star')
        s.applyAura('player', 'essence_burst', { stacks: 1 }) // S2 4pc
      },
    },
    {
      id: 'dragonrage',
      name: 'Dragonrage',
      icon: 'ability_evoker_dragonrage',
      spellId: 375087,
      cooldown: 120,
      onResolve: (s) => {
        s.applyAura('player', 'dragonrage')
        s.applyAura('player', 'essence_burst', { stacks: 2 })
      },
    },
    {
      id: 'engulf',
      name: 'Engulf',
      icon: 'inv_ability_flameshaperevoker_engulf',
      spellId: 443328,
      cooldown: 30,
      onResolve: (s) => {
        const dotUp = s.auraRemains('target', 'fire_breath_dot') > 0
        s.damage('engulf', ENGULF_COEFF * (dotUp ? ENGULF_DOT_MULT : 1), { tags: ['fire'] })
        if (dotUp) s.extendAura('target', 'fire_breath_dot', 4) // fans the flames
        // Apex: Ruby Cataclysm — Engulf extends Dragonrage 2s, 3 times
        const dr = s.aura('player', 'dragonrage')
        if (dr && (dr.data.ext ?? 0) < 3) {
          dr.data.ext = (dr.data.ext ?? 0) + 1
          s.extendAura('player', 'dragonrage', 2)
        }
      },
    },
  ],

  actionBar: [
    'living_flame', 'azure_strike', 'disintegrate', 'fire_breath',
    'eternity_surge', 'shattering_star', 'engulf', 'dragonrage',
  ],

  damageMult: (s) => {
    let m = 1
    if (s.auraRemains('player', 'dragonrage') > 0) m *= DR_MULT
    if (s.auraRemains('target', 'shattering_star') > 0) m *= STAR_AMP
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'disintegrate': return ebUp(s) > 0
      case 'engulf': return s.cooldownRemains('engulf') === 0 && s.auraRemains('target', 'fire_breath_dot') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'dragonrage', text: 'On cooldown (Engulfs extend it — Apex)', when: s => s.cooldownRemains('dragonrage') === 0 },
    { abilityId: 'fire_breath', text: 'On cooldown — keep the dot rolling for Engulf', when: s => s.cooldownRemains('fire_breath') === 0 },
    { abilityId: 'eternity_surge', text: 'On cooldown', when: s => s.cooldownRemains('eternity_surge') === 0 },
    { abilityId: 'shattering_star', text: 'On cooldown — 4s +20% window, grants Essence Burst', when: s => s.cooldownRemains('shattering_star') === 0 },
    { abilityId: 'engulf', text: 'With Fire Breath ticking (consumes and fans the flames)', when: s => s.cooldownRemains('engulf') === 0 && s.auraRemains('target', 'fire_breath_dot') > 4 },
    { abilityId: 'disintegrate', text: 'Essence Burst or 3+ Essence — never cap either', when: s => ebUp(s) > 0 },
    { abilityId: 'living_flame', text: 'Filler — fishes for Essence Burst' },
    { abilityId: 'azure_strike', text: 'Movement only' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Disintegrate
    const fbDot = s.auraRemains('target', 'fire_breath_dot')

    if (s.cooldownRemains('dragonrage') === 0) return 'dragonrage'
    if (s.cooldownRemains('fire_breath') === 0) return 'fire_breath'
    if (s.cooldownRemains('eternity_surge') === 0) return 'eternity_surge'
    if (s.cooldownRemains('shattering_star') === 0) return 'shattering_star'
    if (s.cooldownRemains('engulf') === 0 && fbDot > 4) return 'engulf'
    if (ebUp(s) > 0 || s.insanity >= 3) return 'disintegrate'
    return 'living_flame'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const empowers = ['fire_breath', 'eternity_surge']
    const fillers = ['living_flame', 'disintegrate']
    const burst = ['shattering_star', 'engulf']
    const sets = [empowers, fillers, burst]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
