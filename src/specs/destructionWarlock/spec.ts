import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Destruction Warlock — patch 12.1.0 (Midnight, Season 2), Hellcaller raid
 * ST build (Icy Veins default). Built from the simc `midnight` APL/source
 * and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Soul Shards (max 5) with fractional gains — Incinerate
 * 0.2, Conflagrate 0.5, Immolate crit ticks 0.1, Infernal embers 0.1/pulse.
 * Hellcaller: Immolate runs as Wither — your direct casts stack it to 8
 * and the tick ramps with stacks; Malevolence surges the ramp. Chaos Bolt
 * always crits (modeled like Lava Burst). Talent assumptions: Backdraft
 * (Conflagrate hastens the next 2 casts 30%), Rain of Fire not modeled
 * (single target), Apex: Rain of Chaos 2/2 (Chaos Bolts during Summon
 * Infernal have a 40% chance to call a lesser infernal blast).
 * S2 tier: 2pc Conflagrate +30% (folded into the coefficient); 4pc Chaos
 * Bolt extends Immolate/Wither 2s. APPROX-flagged: Wither ramp numbers,
 * ember cadence. Damage in SP units.
 */

const IMMO_TICK_BASE = 0.15
const IMMO_TICK_PER_STACK = 0.05 // Wither ramp, max 8 stacks
const WITHER_MAX = 8
const INC_COEFF = 0.85
const CONFLAG_COEFF = 0.75        // incl. S2 2pc +30%
const CB_COEFF = 2.4             // always crits
const MALEV_HIT = 1.5
const INFERNAL_IMPACT = 2.0
const INFERNAL_PULSE = 0.25       // 20 pulses over 20s, each +0.1 shard
const RAIN_OF_CHAOS_COEFF = 0.9   // Apex lesser infernal blast
const BACKDRAFT_CAST_MULT = 0.7

/** Hellcaller: direct casts stack Wither on the Immolate debuff */
function addWitherStack(s: SimAPI, n = 1) {
  const a = s.aura('target', 'immolate')
  if (a) a.stacks = Math.min(WITHER_MAX, a.stacks + n)
}

function consumeBackdraft(s: SimAPI) {
  if (s.stacks('player', 'backdraft') > 0) s.consumeStack('player', 'backdraft')
}

export const destructionWarlock: SpecConfig = {
  name: 'Destruction Warlock',
  specId: 'warlock-destruction',
  specIcon: 'spell_shadow_rainoffire',
  resourceName: 'Soul Shards',
  resourceMax: 5,
  startingResource: 3,

  auras: [
    {
      id: 'immolate', name: 'Immolate (Wither)', icon: 'spell_fire_immolation',
      duration: 18, pandemic: true, debuff: true, maxStacks: WITHER_MAX,
      tick: {
        interval: 2, hasted: true,
        onTick: (s, aura) => {
          s.damage('immolate', IMMO_TICK_BASE + IMMO_TICK_PER_STACK * aura.stacks)
          // crit ticks flake off ember shards
          if (s.rng('immolate_shard') < s.stats.critChance) s.gain(0.1, 'immolate')
        },
      },
    },
    { id: 'backdraft', name: 'Backdraft', icon: 'ability_warlock_backdraft', duration: 10, maxStacks: 2 },
    { id: 'infernal', name: 'Summon Infernal', icon: 'spell_shadow_summoninfernal', duration: 20 },
  ],

  abilities: [
    {
      id: 'immolate',
      name: 'Immolate',
      icon: 'spell_fire_immolation',
      spellId: 348,
      castTime: 1.5,
      castTimeMod: (s, base) => base * (s.stacks('player', 'backdraft') > 0 ? BACKDRAFT_CAST_MULT : 1),
      onResolve: (s) => {
        consumeBackdraft(s)
        s.damage('immolate', 0.18)
        s.applyAura('target', 'immolate') // refresh keeps the Wither ramp
      },
    },
    {
      id: 'incinerate',
      name: 'Incinerate',
      icon: 'spell_fire_burnout',
      spellId: 29722,
      castTime: 2.0,
      castTimeMod: (s, base) => base * (s.stacks('player', 'backdraft') > 0 ? BACKDRAFT_CAST_MULT : 1),
      onResolve: (s) => {
        consumeBackdraft(s)
        s.gain(0.3, 'incinerate') // incl. Diabolic Embers-style ember talents (APPROX)
        s.damage('incinerate', INC_COEFF)
        addWitherStack(s)
      },
    },
    {
      id: 'conflagrate',
      name: 'Conflagrate',
      icon: 'spell_fire_fireball',
      spellId: 17962,
      cooldown: 13,
      charges: 2,
      onResolve: (s) => {
        s.gain(0.5, 'conflagrate')
        s.damage('conflagrate', CONFLAG_COEFF)
        s.applyAura('player', 'backdraft', { stacks: 2 })
        addWitherStack(s)
      },
    },
    {
      id: 'chaos_bolt',
      name: 'Chaos Bolt',
      icon: 'ability_warlock_chaosbolt',
      spellId: 116858,
      castTime: 2.5,
      cost: 2,
      castTimeMod: (s, base) => base * (s.stacks('player', 'backdraft') > 0 ? BACKDRAFT_CAST_MULT : 1),
      onResolve: (s) => {
        consumeBackdraft(s)
        s.damage('chaos_bolt', CB_COEFF * s.stats.critMult, { canCrit: false }) // always crits
        addWitherStack(s)
        s.extendAura('target', 'immolate', 2) // S2 4pc
        // Apex: Rain of Chaos
        if (s.auraRemains('player', 'infernal') > 0 && s.rng('rain_of_chaos') < 0.40) {
          s.schedule(s.time + 0.5, () => s.damage('Rain of Chaos', RAIN_OF_CHAOS_COEFF))
        }
      },
    },
    {
      id: 'malevolence',
      name: 'Malevolence',
      icon: 'inv_ability_hellcallerwarlock_malevolence',
      spellId: 442726,
      cooldown: 60,
      onResolve: (s) => {
        s.damage('malevolence', MALEV_HIT)
        s.gain(1, 'malevolence')
        addWitherStack(s, 4) // surges the Wither ramp
      },
    },
    {
      id: 'summon_infernal',
      name: 'Summon Infernal',
      icon: 'spell_shadow_summoninfernal',
      spellId: 1122,
      cooldown: 120,
      onResolve: (s) => {
        s.damage('Infernal', INFERNAL_IMPACT)
        s.applyAura('player', 'infernal')
        for (let i = 0; i < 20; i++) {
          s.schedule(s.time + 1 + i, () => {
            s.damage('Infernal', INFERNAL_PULSE)
            s.gain(0.1, 'infernal')
          })
        }
      },
    },
  ],

  actionBar: [
    'immolate', 'incinerate', 'conflagrate', 'chaos_bolt',
    'malevolence', 'summon_infernal',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'chaos_bolt': return s.insanity >= 4 || (s.insanity >= 2 && s.auraRemains('player', 'infernal') > 0)
      case 'conflagrate': return s.chargesOf('conflagrate') === 2
      case 'incinerate': return s.stacks('player', 'backdraft') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'immolate', text: 'Keep Wither rolling — refresh in pandemic (<5.4s)' },
    { abilityId: 'summon_infernal', text: 'On cooldown — spend hard inside it (Apex: Rain of Chaos)', when: s => s.cooldownRemains('summon_infernal') === 0 },
    { abilityId: 'malevolence', text: 'On cooldown with Wither up — surges the ramp +4', when: s => s.cooldownRemains('malevolence') === 0 },
    { abilityId: 'chaos_bolt', text: 'At 4+ shards, with Backdraft, or inside Infernal — never cap', when: s => s.insanity >= 4 },
    { abilityId: 'conflagrate', text: 'Keep charges rolling — feeds Backdraft', when: s => s.chargesOf('conflagrate') === 2 },
    { abilityId: 'incinerate', text: 'Filler — always be casting' },
  ],

  policy: (s) => {
    const imm = s.auraRemains('target', 'immolate')
    const shards = s.insanity
    const backdraft = s.stacks('player', 'backdraft')
    const infernalUp = s.auraRemains('player', 'infernal') > 0

    if (imm <= 0) return 'immolate'
    if (imm < 18 * 0.3) return 'immolate'
    if (s.cooldownRemains('summon_infernal') === 0) return 'summon_infernal'
    if (s.cooldownRemains('malevolence') === 0) return 'malevolence'
    if (shards >= 2 && (shards >= 4 || infernalUp || backdraft > 0)) return 'chaos_bolt'
    if (s.chargesOf('conflagrate') === 2 || (backdraft === 0 && s.chargesOf('conflagrate') > 0)) return 'conflagrate'
    return 'incinerate'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['incinerate', 'conflagrate']
    const burst = ['chaos_bolt', 'malevolence']
    const sets = [fillers, burst]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
