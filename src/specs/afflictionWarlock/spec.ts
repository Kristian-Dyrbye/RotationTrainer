import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Affliction Warlock — patch 12.1.0 (Midnight, Season 2), Soul Harvester
 * raid ST build (Icy Veins default). Built from the simc `midnight`
 * APL/source and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Soul Shards (max 5). Agony ramps to 10 stacks and is the
 * shard engine (gen chance scales with stacks, simc-style accumulator
 * APPROX). Soul Harvester: Drain Soul ticks tear off Succulent Souls that
 * empower Malefic Rapture. Talent assumptions: Unstable Affliction,
 * Malefic Rapture core, Summon Darkglare + Soul Rot,
 * Apex: Creeping Harvest 3/3 (each Malefic Rapture creeps all three DoTs
 * forward 1s). S2 tier: 2pc Unstable Affliction +25% (folded into the
 * coefficient); 4pc Soul Rot rips out 2 Succulent Souls.
 * APPROX-flagged: shard-gen rates, Succulent Soul proc rate, Darkglare
 * beam cadence. Damage in SP units.
 */

const AGONY_TICK_PER_STACK = 0.055 // ramps 1..10 stacks
const AGONY_MAX_STACKS = 10
const CORR_TICK = 0.34
const UA_TICK = 0.46               // incl. S2 2pc +25%
const MR_PER_DOT = 0.62
const SUCCULENT_MULT = 1.6         // Soul Harvester: empowered Rapture
const DS_TICK = 0.30
const SOUL_ROT_HIT = 1.2
const SOUL_ROT_PULSE = 0.55        // 4 pulses over 8s (scheduled, not a DoT)
const GLARE_PULSE = 0.38           // per active DoT, 10 beams over 20s
const SUCCULENT_CHANCE = 0.25      // APPROX: per Drain Soul tick

const DOT_IDS = ['agony', 'corruption', 'unstable_affliction'] as const

function dotCount(s: SimAPI): number {
  let n = 0
  for (const id of DOT_IDS) if (s.auraRemains('target', id) > 0) n++
  return n
}

export const afflictionWarlock: SpecConfig = {
  name: 'Affliction Warlock',
  specId: 'warlock-affliction',
  specIcon: 'spell_shadow_deathcoil',
  resourceName: 'Soul Shards',
  resourceMax: 5,
  startingResource: 3,

  auras: [
    {
      id: 'agony', name: 'Agony', icon: 'spell_shadow_curseofsargeras',
      duration: 18, pandemic: true, debuff: true, maxStacks: AGONY_MAX_STACKS,
      tick: {
        interval: 2, hasted: true,
        onTick: (s, aura) => {
          s.damage('agony', AGONY_TICK_PER_STACK * aura.stacks)
          aura.stacks = Math.min(AGONY_MAX_STACKS, aura.stacks + 1)
          // shard trickle scales with the ramp (APPROX accumulator)
          if (s.rng('agony_shard') < 0.04 + 0.016 * aura.stacks) s.gain(1, 'agony')
        },
      },
    },
    {
      id: 'corruption', name: 'Corruption', icon: 'spell_shadow_abominationexplosion',
      duration: 14, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('corruption', CORR_TICK) },
    },
    {
      id: 'unstable_affliction', name: 'Unstable Affliction', icon: 'spell_shadow_unstableaffliction_3',
      duration: 21, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('unstable_affliction', UA_TICK) },
    },
    { id: 'succulent_soul', name: 'Succulent Soul', icon: 'inv_soulbarrier', duration: 20, maxStacks: 2 },
    { id: 'darkglare', name: 'Summon Darkglare', icon: 'inv_beholderwarlock', duration: 20 },
  ],

  abilities: [
    {
      id: 'agony',
      name: 'Agony',
      icon: 'spell_shadow_curseofsargeras',
      spellId: 980,
      onResolve: (s) => {
        s.damage('agony', 0.05)
        s.applyAura('target', 'agony') // refresh keeps the ramp
      },
    },
    {
      id: 'corruption',
      name: 'Corruption',
      icon: 'spell_shadow_abominationexplosion',
      spellId: 172,
      onResolve: (s) => {
        s.damage('corruption', 0.12)
        s.applyAura('target', 'corruption')
      },
    },
    {
      id: 'unstable_affliction',
      name: 'Unstable Affliction',
      icon: 'spell_shadow_unstableaffliction_3',
      spellId: 316099,
      castTime: 1.5,
      onResolve: (s) => {
        s.damage('unstable_affliction', 0.25)
        s.applyAura('target', 'unstable_affliction')
      },
    },
    {
      id: 'malefic_rapture',
      name: 'Malefic Rapture',
      icon: 'ability_warlock_everlastingaffliction',
      spellId: 324536,
      castTime: 1.5,
      cost: 1,
      onResolve: (s) => {
        let mult = 1
        if (s.stacks('player', 'succulent_soul') > 0) {
          s.consumeStack('player', 'succulent_soul')
          mult = SUCCULENT_MULT
        }
        s.damage('malefic_rapture', MR_PER_DOT * dotCount(s) * mult)
        // Apex: Creeping Harvest — each Rapture creeps all DoTs 1s forward
        for (const id of DOT_IDS) {
          if (s.auraRemains('target', id) > 0) s.extendAura('target', id, 1)
        }
      },
    },
    {
      id: 'drain_soul',
      name: 'Drain Soul',
      icon: 'spell_shadow_haunting',
      spellId: 198590,
      channel: {
        duration: 4.5,
        ticks: 5,
        hasted: true,
        onTick: (s) => {
          s.damage('drain_soul', DS_TICK)
          if (s.rng('succulent_soul') < SUCCULENT_CHANCE) s.applyAura('player', 'succulent_soul', { stacks: 1 })
        },
      },
      onResolve: () => {},
    },
    {
      id: 'soul_rot',
      name: 'Soul Rot',
      icon: 'ability_ardenweald_warlock',
      spellId: 386997,
      cooldown: 60,
      onResolve: (s) => {
        s.damage('soul_rot', SOUL_ROT_HIT)
        s.gain(1, 'soul_rot')
        s.applyAura('player', 'succulent_soul', { stacks: 2 }) // S2 4pc
        for (let i = 0; i < 4; i++) {
          s.schedule(s.time + 2 + i * 2, () => s.damage('soul_rot', SOUL_ROT_PULSE))
        }
      },
    },
    {
      id: 'summon_darkglare',
      name: 'Summon Darkglare',
      icon: 'inv_beholderwarlock',
      spellId: 205180,
      cooldown: 120,
      onResolve: (s) => {
        s.applyAura('player', 'darkglare')
        for (const id of DOT_IDS) {
          if (s.auraRemains('target', id) > 0) s.extendAura('target', id, 8)
        }
        for (let i = 0; i < 10; i++) {
          s.schedule(s.time + 1 + i * 2, () => s.damage('Darkglare', GLARE_PULSE * dotCount(s)))
        }
      },
    },
  ],

  actionBar: [
    'agony', 'corruption', 'unstable_affliction', 'malefic_rapture',
    'drain_soul', 'soul_rot', 'summon_darkglare',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'malefic_rapture': return s.stacks('player', 'succulent_soul') > 0
      case 'summon_darkglare': return s.cooldownRemains('summon_darkglare') === 0 && dotCount(s) === 3
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'agony', text: 'Keep rolling — the ramp is your shard engine (refresh <5.4s)' },
    { abilityId: 'corruption', text: 'Keep rolling (refresh <4.2s)' },
    { abilityId: 'unstable_affliction', text: 'Keep rolling (refresh <6.3s)' },
    { abilityId: 'summon_darkglare', text: 'With all 3 DoTs up — extends them 8s', when: s => s.cooldownRemains('summon_darkglare') === 0 && dotCount(s) === 3 },
    { abilityId: 'soul_rot', text: 'On cooldown once DoTs are up (4pc: 2 Succulent Souls)', when: s => s.cooldownRemains('soul_rot') === 0 && dotCount(s) === 3 },
    { abilityId: 'malefic_rapture', text: 'Spend Succulent Souls; dump at 4+ shards or inside Darkglare', when: s => s.stacks('player', 'succulent_soul') > 0 && s.insanity >= 1 },
    { abilityId: 'drain_soul', text: 'Filler — clip freely for anything above' },
  ],

  policy: (s) => {
    const agony = s.auraRemains('target', 'agony')
    const corr = s.auraRemains('target', 'corruption')
    const ua = s.auraRemains('target', 'unstable_affliction')
    const shards = s.insanity
    const succ = s.stacks('player', 'succulent_soul')
    const glareUp = s.auraRemains('player', 'darkglare') > 0

    if (agony <= 0) return 'agony'
    if (corr <= 0) return 'corruption'
    if (ua <= 0) return 'unstable_affliction'
    // pandemic refreshes
    if (agony < 18 * 0.3) return 'agony'
    if (corr < 14 * 0.3) return 'corruption'
    if (ua < 21 * 0.3) return 'unstable_affliction'

    if (s.cooldownRemains('summon_darkglare') === 0) return 'summon_darkglare'
    if (s.cooldownRemains('soul_rot') === 0) return 'soul_rot'

    if (shards >= 1 && (succ > 0 || shards >= 4 || glareUp)) return 'malefic_rapture'
    return 'drain_soul'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const dotRefresh = ['agony', 'corruption', 'unstable_affliction']
    const spenders = ['malefic_rapture', 'drain_soul']
    const sets = [dotRefresh, spenders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
