import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Affliction Warlock — patch 12.1.0 (Midnight, Season 2), Hellcaller raid
 * single-target build (alternate to the default Soul Harvester build).
 * Verified against live guides 2026-08-24:
 *  - Wowhead rotation guide: https://www.wowhead.com/guide/classes/warlock/affliction/rotation-cooldowns-pve-dps
 *  - Method: https://www.method.gg/guides/affliction-warlock/playstyle-and-rotation
 *  - Icy Veins: https://www.icy-veins.com/wow/affliction-warlock-pve-dps-rotation-cooldowns-abilities
 *  - Kalamazi (talent string + opener order): https://www.kalamazi.gg/guides/affliction
 *
 * Hellcaller: Corruption is replaced by Wither — a stacking DoT (max 8).
 * Shard spenders add Wither stacks (+2 inside Malevolence), and at 8
 * stacks Seeds of Their Demise burns stacks off for bonus damage.
 * Malevolence instantly adds +6 Wither stacks and hastes you for 20s —
 * pool shards going in and dump Unstable Affliction inside. The 12.1
 * UA-as-spender redesign is spec-wide (Method + Kalamazi both list
 * "dump Unstable Affliction" for Hellcaller — Malefic Rapture stays out
 * of ST). Dark Harvest does NOT generate shards for Hellcaller — press
 * it on cooldown before Darkglare. S2 tier: 2pc Wither +25% / Agony +15%
 * (folded into tick coefficients); 4pc each active UA grants +2% damage.
 * APPROX: all coefficients, Wither ramp/Seeds numbers, Agony
 * shard-trickle accumulator, Nightfall and Shard Instability proc rates,
 * Darkglare beam cadence, Malevolence haste value.
 */

const AGONY_TICK_PER_STACK = 0.063 // incl. S2 2pc +15%; ramps 1..10 stacks
const AGONY_MAX_STACKS = 10
const WITHER_TICK_BASE = 0.20      // incl. S2 2pc +25%
const WITHER_TICK_PER_STACK = 0.045
const WITHER_MAX = 8
const SEEDS_BONUS = 0.35           // APPROX: Seeds of Their Demise burn per tick at cap
const UA_TICK = 0.46
const UA_IMPACT = 0.25
const HAUNT_HIT = 0.7
const HAUNT_AMP = 1.07             // APPROX: Haunt target damage amp
const DS_TICK = 0.30
const NIGHTFALL_DS_MULT = 1.5      // Nightfall: faster, harder Drain Soul
const DARK_HARVEST_PER_DOT = 1.1   // hits harder for Hellcaller (no shard gen)
const DARKGLARE_DOT_MULT = 1.2     // Darkglare: DoTs +20% while active
const GLARE_BEAM = 0.25            // APPROX: small beam every 2s, 10 beams
const TIER4PC_PER_UA = 1.02        // S2 4pc: +2% damage per active UA
const NIGHTFALL_CHANCE = 0.15      // APPROX: per Wither tick
const INSTABILITY_CHANCE = 0.08    // APPROX: per Agony tick
const MALEV_HIT = 1.2
const MALEV_HASTE = 0.10
const MALEV_WITHER_STACKS = 6      // Malevolence: instant +6 Wither stacks

const DOT_IDS = ['agony', 'wither', 'unstable_affliction'] as const

function dotCount(s: SimAPI): number {
  let n = 0
  for (const id of DOT_IDS) if (s.auraRemains('target', id) > 0) n++
  return n
}

/** Hellcaller: shard spenders stack Wither (+2 inside Malevolence) */
function addWitherStack(s: SimAPI, n = 1) {
  const a = s.aura('target', 'wither')
  if (a) a.stacks = Math.min(WITHER_MAX, a.stacks + n)
}

function spenderWither(s: SimAPI) {
  addWitherStack(s, s.auraRemains('player', 'malevolence') > 0 ? 2 : 1)
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

export const afflictionHellcaller: SpecConfig = {
  name: 'Affliction Warlock',
  specId: 'warlock-affliction',
  specIcon: 'spell_shadow_deathcoil',
  buildId: 'hellcaller',
  resourceName: 'Soul Shards',
  resourceMax: 5,
  startingResource: 3,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/warlock/affliction/rotation-cooldowns-pve-dps',
    buildName: 'Hellcaller Raid Single Target',
    heroTalent: 'Hellcaller',
    // published verbatim by kalamazi.gg ("Hellcaller Affliction Single Target")
    talentString: 'EAORKURFVUVFUVGIUBANVVVSVRFFUZFQ0BAFFVVVUBA',
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
      id: 'wither', name: 'Wither', icon: 'inv_ability_hellcallerwarlock_wither',
      duration: 18, pandemic: true, debuff: true, maxStacks: WITHER_MAX,
      tick: {
        interval: 2, hasted: true,
        onTick: (s, aura) => {
          s.damage('wither', WITHER_TICK_BASE + WITHER_TICK_PER_STACK * aura.stacks)
          // Seeds of Their Demise: at cap the stacks burn off for bonus damage
          if (aura.stacks >= WITHER_MAX) {
            s.damage('Seeds of Their Demise', SEEDS_BONUS)
            aura.stacks -= 1
          }
          // Wither carries Corruption's Nightfall proc role
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
    { id: 'malevolence', name: 'Malevolence', icon: 'inv_ability_hellcallerwarlock_malevolence', duration: 20 },
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
      id: 'wither',
      name: 'Wither',
      icon: 'inv_ability_hellcallerwarlock_wither',
      spellId: 445468,
      onResolve: (s) => {
        s.damage('wither', 0.12)
        s.applyAura('target', 'wither') // refresh keeps the stack ramp
        addWitherStack(s)
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
        if (freeUA(s)) s.removeAura('player', 'shard_instability')
        s.damage('unstable_affliction', UA_IMPACT)
        s.applyAura('target', 'unstable_affliction')
        spenderWither(s) // Hellcaller: spenders feed the Wither ramp
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
        // Hellcaller's Dark Harvest generates NO shards — it just hits hard
        // per afflicted DoT; press it on cooldown, before Darkglare
        s.damage('dark_harvest', DARK_HARVEST_PER_DOT * dotCount(s))
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
        s.applyAura('player', 'malevolence')
        addWitherStack(s, MALEV_WITHER_STACKS) // instant +6 Wither stacks
      },
    },
    {
      id: 'summon_darkglare',
      name: 'Summon Darkglare',
      icon: 'inv_beholderwarlock',
      spellId: 205180,
      cooldown: 120,
      onResolve: (s) => {
        // 12.1: Darkglare is a 20s window — Agony/Wither/UA deal +20%
        s.applyAura('player', 'darkglare')
        for (let i = 0; i < 10; i++) {
          s.schedule(s.time + 1 + i * 2, () => s.damage('Darkglare', GLARE_BEAM * dotCount(s)))
        }
      },
    },
  ],

  actionBar: [
    'agony', 'wither', 'unstable_affliction', 'haunt',
    'drain_soul', 'dark_harvest', 'malevolence', 'summon_darkglare',
  ],

  damageMult: (s, spellId) => {
    let mult = 1
    if (s.auraRemains('target', 'haunt') > 0) mult *= HAUNT_AMP
    if (s.auraRemains('target', 'unstable_affliction') > 0) mult *= TIER4PC_PER_UA // S2 4pc
    if (s.auraRemains('player', 'darkglare') > 0
      && (DOT_IDS as readonly string[]).includes(spellId)) mult *= DARKGLARE_DOT_MULT
    return mult
  },

  // Cascading Calamity (APPROX 5%) + Malevolence haste windows
  hasteMod: (s) =>
    (s.auraRemains('player', 'cascading_calamity') > 0 ? 0.05 : 0)
    + (s.auraRemains('player', 'malevolence') > 0 ? MALEV_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'unstable_affliction': return freeUA(s) || (s.auraRemains('player', 'malevolence') > 0 && s.insanity >= 1)
      case 'drain_soul': return s.stacks('player', 'nightfall') > 0
      case 'summon_darkglare': return s.cooldownRemains('summon_darkglare') === 0 && s.insanity >= 3
      case 'dark_harvest': return s.cooldownRemains('dark_harvest') === 0
      case 'malevolence': return s.cooldownRemains('malevolence') === 0 && s.insanity >= 2
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'agony', text: 'Keep rolling — the ramp is your shard engine (refresh <5.4s)' },
    { abilityId: 'wither', text: 'Keep Wither rolling — its ticks proc Nightfall (refresh <5.4s)' },
    { abilityId: 'haunt', text: 'On cooldown — amps all your damage', when: s => s.cooldownRemains('haunt') === 0 },
    { abilityId: 'dark_harvest', text: 'On cooldown, before Darkglare — no shard gen for Hellcaller', when: s => s.cooldownRemains('dark_harvest') === 0 },
    { abilityId: 'summon_darkglare', text: 'On cooldown at ≥3 shards — DoTs +20% for 20s', when: s => s.cooldownRemains('summon_darkglare') === 0 && s.insanity >= 3 },
    { abilityId: 'malevolence', text: 'Pool shards, press it (+6 Wither stacks, haste), then dump', when: s => s.cooldownRemains('malevolence') === 0 && s.insanity >= 2 },
    { abilityId: 'unstable_affliction', text: 'Keep the DoT + Cascading Calamity up; spend Shard Instability procs', when: s => freeUA(s) || s.auraRemains('player', 'cascading_calamity') < 4.5 },
    { abilityId: 'drain_soul', label: 'Drain Soul: Nightfall', icon: 'spell_shadow_twilight', text: 'Spend Nightfall procs — don’t overcap (2 stacks)', when: s => s.stacks('player', 'nightfall') > 0 },
    { abilityId: 'unstable_affliction', text: 'Spend at 4+ shards — dump inside Malevolence (each cast +Wither stacks)' },
    { abilityId: 'drain_soul', text: 'Filler — clip freely for anything above' },
  ],

  /** Oracle — Method/Kalamazi 12.1 ST priority for Hellcaller. */
  policy: (s) => {
    const agony = s.auraRemains('target', 'agony')
    const wither = s.auraRemains('target', 'wither')
    const uaDot = s.auraRemains('target', 'unstable_affliction')
    const shards = s.insanity
    const canUA = shards >= 1 || freeUA(s)
    const malevUp = s.auraRemains('player', 'malevolence') > 0

    // DoT upkeep first — everything scales off them
    if (agony <= 0 || agony < 18 * 0.3) return 'agony'
    if (wither <= 0 || wither < 18 * 0.3) return 'wither'

    // haunt: on cooldown
    if (s.cooldownRemains('haunt') === 0) return 'haunt'

    // dark_harvest: on cooldown, before Darkglare (no shard condition —
    // the Hellcaller version generates nothing)
    if (s.cooldownRemains('dark_harvest') === 0) return 'dark_harvest'

    // summon_darkglare: on cooldown at ≥3 shards, with all DoTs ticking
    if (s.cooldownRemains('summon_darkglare') === 0 && shards >= 3 && dotCount(s) === 3) return 'summon_darkglare'

    // malevolence: with a few shards pooled so the window gets fed
    if (s.cooldownRemains('malevolence') === 0 && shards >= 2) return 'malevolence'

    // unstable_affliction: keep the DoT and Cascading Calamity up; never
    // sit on a Shard Instability proc
    if (canUA && (uaDot <= 0 || freeUA(s) || s.auraRemains('player', 'cascading_calamity') < 4.5)) {
      return 'unstable_affliction'
    }

    // drain_soul with Nightfall
    if (s.stacks('player', 'nightfall') > 0) return 'drain_soul'

    // unstable_affliction: never cap; dump hard inside Malevolence — each
    // spend adds +2 Wither stacks there
    if (shards >= 4 || (malevUp && shards >= 1)) return 'unstable_affliction'

    // filler
    return 'drain_soul'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const dotRefresh = ['agony', 'wither']
    const spenders = ['unstable_affliction', 'drain_soul']
    const sets = [dotRefresh, spenders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
