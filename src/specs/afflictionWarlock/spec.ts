import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Affliction Warlock — patch 12.1.0 (Midnight, Season 2), Soul Harvester
 * raid single-target build. Verified against live guides 2026-08-24:
 *  - Wowhead rotation guide: https://www.wowhead.com/guide/classes/warlock/affliction/rotation-cooldowns-pve-dps
 *  - Icy Veins: https://www.icy-veins.com/wow/affliction-warlock-pve-dps-rotation-cooldowns-abilities
 *  - Method: https://www.method.gg/guides/affliction-warlock/playstyle-and-rotation
 *  - Maxroll raid guide: https://maxroll.gg/wow/class-guides/affliction-warlock-raid-guide
 *  - Kalamazi (talent string): https://www.kalamazi.gg/guides/affliction
 *
 * 12.1 redesign: Malefic Rapture is gone from single target — Unstable
 * Affliction is the Soul Shard spender (and a DoT). Keep Agony + Corruption
 * rolling, Haunt on cooldown, recast UA to hold the Cascading Calamity
 * haste buff, Dark Harvest on cooldown at ≤2 shards (it generates shards
 * for Soul Harvester), Summon Darkglare at ≥3 shards (now a 20% DoT damage
 * window), Drain Soul with Nightfall procs, UA to avoid capping, Drain
 * Soul filler. S2 tier: 2pc Corruption +25% / Agony +15% (folded into tick
 * coefficients); 4pc each active UA grants +2% damage (modeled, ST = one
 * UA). APPROX: all coefficients, Agony shard-trickle accumulator, Nightfall
 * and Shard Instability proc rates, Darkglare beam cadence, Soul Harvester
 * shard-spend CDR on Dark Harvest (1s per shard).
 */

const AGONY_TICK_PER_STACK = 0.063 // incl. S2 2pc +15%; ramps 1..10 stacks
const AGONY_MAX_STACKS = 10
const CORR_TICK = 0.42             // incl. S2 2pc +25%
const UA_TICK = 0.46
const UA_IMPACT = 0.25
const HAUNT_HIT = 0.7
const HAUNT_AMP = 1.07             // APPROX: Haunt target damage amp
const DS_TICK = 0.30
const NIGHTFALL_DS_MULT = 1.5      // Nightfall: faster, harder Drain Soul
const DARK_HARVEST_PER_DOT = 0.9
const DARKGLARE_DOT_MULT = 1.2     // Darkglare: DoTs +20% while active
const GLARE_BEAM = 0.25            // APPROX: small beam every 2s, 10 beams
const TIER4PC_PER_UA = 1.02        // S2 4pc: +2% damage per active UA
const NIGHTFALL_CHANCE = 0.15      // APPROX: per Corruption tick
const INSTABILITY_CHANCE = 0.08    // APPROX: per Agony tick

const DOT_IDS = ['agony', 'corruption', 'unstable_affliction'] as const

function dotCount(s: SimAPI): number {
  let n = 0
  for (const id of DOT_IDS) if (s.auraRemains('target', id) > 0) n++
  return n
}

/** free Unstable Affliction from a Shard Instability proc? */
function freeUA(s: SimAPI): boolean {
  return s.auraRemains('player', 'shard_instability') > 0
}

/** is the Drain Soul button currently in its Nightfall form? */
function nightfallActive(s: SimAPI): boolean {
  if (s.casting?.abilityId === 'drain_soul') return s.data.nf_cast === 1
  return s.stacks('player', 'nightfall') > 0
}

export const afflictionWarlock: SpecConfig = {
  name: 'Affliction Warlock',
  specId: 'warlock-affliction',
  specIcon: 'spell_shadow_deathcoil',
  resourceName: 'Soul Shards',
  resourceMax: 5,
  startingResource: 3,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/warlock/affliction/rotation-cooldowns-pve-dps',
    buildName: 'Soul Harvester Raid Single Target',
    heroTalent: 'Soul Harvester',
    // published verbatim by kalamazi.gg ("Soul Harvester Affliction Single Target")
    talentString: 'EAORKURFVUVFUVGIUBANVVVSVVFBUZFQ0BQFFVVVUBQ',
    retrieved: '2026-08-24',
  },

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
          // Shard Instability: free Unstable Affliction proc (APPROX source)
          if (s.rng('shard_instability') < INSTABILITY_CHANCE) s.applyAura('player', 'shard_instability')
        },
      },
    },
    {
      id: 'corruption', name: 'Corruption', icon: 'spell_shadow_abominationexplosion',
      duration: 14, pandemic: true, debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          s.damage('corruption', CORR_TICK)
          if (s.rng('nightfall') < NIGHTFALL_CHANCE) s.applyAura('player', 'nightfall', { stacks: 1 })
        },
      },
    },
    {
      id: 'unstable_affliction', name: 'Unstable Affliction', icon: 'spell_shadow_unstableaffliction_3',
      duration: 21, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('unstable_affliction', UA_TICK) },
    },
    {
      id: 'haunt', name: 'Haunt', icon: 'ability_warlock_haunt',
      duration: 18, pandemic: true, debuff: true,
    },
    {
      id: 'cascading_calamity', name: 'Cascading Calamity', icon: 'ability_warlock_eradication',
      duration: 15, // recast UA before it drops to keep the haste rolling
    },
    { id: 'nightfall', name: 'Nightfall', icon: 'spell_shadow_twilight', duration: 20, maxStacks: 2 },
    { id: 'shard_instability', name: 'Shard Instability', icon: 'spell_warlock_soulburn', duration: 15 },
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
      id: 'haunt',
      name: 'Haunt',
      icon: 'ability_warlock_haunt',
      spellId: 48181,
      castTime: 1.5,
      cooldown: 15,
      onResolve: (s) => {
        s.damage('haunt', HAUNT_HIT)
        s.applyAura('target', 'haunt')
      },
    },
    {
      id: 'unstable_affliction',
      name: 'Unstable Affliction',
      icon: 'spell_shadow_unstableaffliction_3',
      spellId: 316099,
      castTime: 1.5,
      cost: 1,
      costMod: (s) => (freeUA(s) ? 0 : 1),
      onResolve: (s) => {
        // Cascading Calamity: recasting UA while it ticks keeps the buff up
        if (s.auraRemains('target', 'unstable_affliction') > 0) s.applyAura('player', 'cascading_calamity')
        if (freeUA(s)) {
          s.removeAura('player', 'shard_instability')
        } else {
          // Soul Harvester: shards spent shave Dark Harvest's cooldown (APPROX 1s/shard)
          s.reduceCooldown('dark_harvest', 1)
        }
        s.damage('unstable_affliction', UA_IMPACT)
        s.applyAura('target', 'unstable_affliction')
      },
    },
    {
      // One button, as in game: a Nightfall proc transforms the channel.
      id: 'drain_soul',
      name: 'Drain Soul',
      icon: 'spell_shadow_haunting',
      spellId: 198590,
      displayName: (s) => (nightfallActive(s) ? 'Drain Soul: Nightfall' : 'Drain Soul'),
      displayIcon: (s) => (nightfallActive(s) ? 'spell_shadow_twilight' : 'spell_shadow_haunting'),
      displayStacks: (s) => s.stacks('player', 'nightfall'),
      onCastStart: (s) => {
        s.data.nf_cast = s.stacks('player', 'nightfall') > 0 ? 1 : 0
        if (s.data.nf_cast) s.consumeStack('player', 'nightfall')
      },
      channel: (s) => (s.data.nf_cast
        ? {
            duration: 2.25, // Nightfall: channels 50% faster and hits harder
            ticks: 5,
            hasted: true,
            onTick: (sim) => sim.damage('drain_soul', DS_TICK * NIGHTFALL_DS_MULT),
          }
        : {
            duration: 4.5,
            ticks: 5,
            hasted: true,
            onTick: (sim) => sim.damage('drain_soul', DS_TICK),
          }),
      onResolve: () => {},
    },
    {
      id: 'dark_harvest',
      name: 'Dark Harvest',
      icon: 'spell_shadow_shadesofdarkness',
      spellId: 1221094,
      cooldown: 60,
      onResolve: (s) => {
        // consumes the life force of each target afflicted by your DoTs;
        // Soul Harvester version generates Soul Shards — use at ≤2 shards
        s.damage('dark_harvest', DARK_HARVEST_PER_DOT * dotCount(s))
        s.gain(3, 'dark_harvest')
      },
    },
    {
      id: 'summon_darkglare',
      name: 'Summon Darkglare',
      icon: 'inv_beholderwarlock',
      spellId: 205180,
      cooldown: 120,
      onResolve: (s) => {
        // 12.1: Darkglare is a 20s window — Agony/Corruption/UA deal +20%
        s.applyAura('player', 'darkglare')
        for (let i = 0; i < 10; i++) {
          s.schedule(s.time + 1 + i * 2, () => s.damage('Darkglare', GLARE_BEAM * dotCount(s)))
        }
      },
    },
  ],

  actionBar: [
    'agony', 'corruption', 'unstable_affliction', 'haunt',
    'drain_soul', 'dark_harvest', 'summon_darkglare',
  ],

  damageMult: (s, spellId) => {
    let mult = 1
    if (s.auraRemains('target', 'haunt') > 0) mult *= HAUNT_AMP
    if (s.auraRemains('target', 'unstable_affliction') > 0) mult *= TIER4PC_PER_UA // S2 4pc
    if (s.auraRemains('player', 'darkglare') > 0
      && (DOT_IDS as readonly string[]).includes(spellId)) mult *= DARKGLARE_DOT_MULT
    return mult
  },

  // Cascading Calamity: recent UA recast grants haste (APPROX 5%)
  hasteMod: (s) => (s.auraRemains('player', 'cascading_calamity') > 0 ? 0.05 : 0),

  glows: (s, id) => {
    switch (id) {
      case 'unstable_affliction': return freeUA(s)
      case 'drain_soul': return s.stacks('player', 'nightfall') > 0
      case 'summon_darkglare': return s.cooldownRemains('summon_darkglare') === 0 && s.insanity >= 3
      case 'dark_harvest': return s.cooldownRemains('dark_harvest') === 0 && s.insanity <= 2
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'agony', text: 'Keep rolling — the ramp is your shard engine (refresh <5.4s)' },
    { abilityId: 'corruption', text: 'Keep rolling — its ticks proc Nightfall (refresh <4.2s)' },
    { abilityId: 'haunt', text: 'On cooldown — amps all your damage', when: s => s.cooldownRemains('haunt') === 0 },
    { abilityId: 'unstable_affliction', text: 'Keep the DoT + Cascading Calamity up; spend Shard Instability procs', when: s => freeUA(s) || s.auraRemains('player', 'cascading_calamity') < 4.5 },
    { abilityId: 'dark_harvest', text: 'On cooldown at ≤2 shards — it generates 3', when: s => s.cooldownRemains('dark_harvest') === 0 && s.insanity <= 2 },
    { abilityId: 'summon_darkglare', text: 'On cooldown at ≥3 shards — DoTs +20% for 20s, dump inside', when: s => s.cooldownRemains('summon_darkglare') === 0 && s.insanity >= 3 },
    { abilityId: 'drain_soul', label: 'Drain Soul: Nightfall', icon: 'spell_shadow_twilight', text: 'Spend Nightfall procs — don’t overcap (2 stacks)', when: s => s.stacks('player', 'nightfall') > 0 },
    { abilityId: 'unstable_affliction', text: 'Spend at 4+ shards — never cap' },
    { abilityId: 'drain_soul', text: 'Filler — clip freely for anything above' },
  ],

  /** Oracle — Wowhead/Maxroll 12.1 ST priority for Soul Harvester. */
  policy: (s) => {
    const agony = s.auraRemains('target', 'agony')
    const corr = s.auraRemains('target', 'corruption')
    const uaDot = s.auraRemains('target', 'unstable_affliction')
    const shards = s.insanity
    const canUA = shards >= 1 || freeUA(s)

    // DoT upkeep first — everything scales off them
    if (agony <= 0 || agony < 18 * 0.3) return 'agony'
    if (corr <= 0 || corr < 14 * 0.3) return 'corruption'

    // haunt: on cooldown
    if (s.cooldownRemains('haunt') === 0) return 'haunt'

    // unstable_affliction: keep the DoT and Cascading Calamity up; never
    // sit on a Shard Instability proc
    if (canUA && (uaDot <= 0 || freeUA(s) || s.auraRemains('player', 'cascading_calamity') < 4.5)) {
      return 'unstable_affliction'
    }

    // dark_harvest: on cooldown at ≤2 shards (it generates 3)
    if (s.cooldownRemains('dark_harvest') === 0 && shards <= 2) return 'dark_harvest'

    // summon_darkglare: on cooldown at ≥3 shards, with all DoTs ticking
    if (s.cooldownRemains('summon_darkglare') === 0 && shards >= 3 && dotCount(s) === 3) return 'summon_darkglare'

    // drain_soul with Nightfall
    if (s.stacks('player', 'nightfall') > 0) return 'drain_soul'

    // unstable_affliction: never cap shards (aggressive spending also
    // shaves Dark Harvest's cooldown)
    if (shards >= 4) return 'unstable_affliction'

    // filler
    return 'drain_soul'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const dotRefresh = ['agony', 'corruption']
    const spenders = ['unstable_affliction', 'drain_soul']
    const sets = [dotRefresh, spenders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
