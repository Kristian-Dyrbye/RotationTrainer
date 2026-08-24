import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Enhancement Shaman — patch 12.1.0 (Midnight, Season 2), Stormbringer raid
 * ST build (Icy Veins default). Built from the simc `midnight` APL/source and
 * Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Maelstrom Weapon (max 10) as the primary bar — built by
 * dual-wield autos, Stormstrike, Lava Lash, and Feral Spirits; spent 5-10 at
 * a time on instant Lightning Bolt / Elemental Blast (both gated at 5+, so
 * they are always instant here). Mana is not modeled.
 * Stat links: swing speed is hasted (more autos → more Maelstrom, Windfury
 * and Hot Hand rolls); Stormsurge procs off the real crit chance.
 * Talent assumptions: Windfury 20% (60% under Doom Winds), Hot Hand,
 * Stormbringer — every 40 Maelstrom spent charges a Tempest that transforms
 * the Lightning Bolt button; Apex: Storm's Legacy 3/3 (each Tempest grants
 * Stormsurge). S2 tier: 2pc Stormstrike +20% folded into the coefficient;
 * 4pc Feral Spirits grants Stormsurge on cast. APPROX-flagged: proc rates,
 * auto cadence, per-stack spender scaling. Damage in AP units.
 */

const AUTO_COEFF = 0.30
const SWING_TIME = 1.4          // APPROX combined DW stream
const WF_COEFF = 0.55
const WF_CHANCE = 0.20
const WF_DOOM_CHANCE = 0.60     // during Doom Winds
const HOT_HAND_CHANCE = 0.05    // APPROX per swing
const SS_COEFF = 1.5            // both hands, incl. S2 2pc +20%
const LL_COEFF = 1.05
const HOT_HAND_MULT = 1.4
const LB_PER_MSW = 0.19         // APPROX per stack spent
const EB_PER_MSW = 0.30         // APPROX per stack spent
const TEMPEST_COEFF = 2.8
const FS_DIRECT = 0.35
const FS_TICK = 0.30
const WOLF_PULSE = 0.25
const TEMPEST_THRESHOLD = 40    // Maelstrom spent per Tempest

function spendMsw(s: SimAPI): number {
  const n = Math.min(10, Math.floor(s.insanity))
  s.data.msw_total = (s.data.msw_total ?? 0) + n
  // Stormbringer: every 40 Maelstrom spent charges a Tempest
  if (s.data.msw_total >= TEMPEST_THRESHOLD) {
    s.data.msw_total -= TEMPEST_THRESHOLD
    s.applyAura('player', 'tempest_proc')
  }
  return n
}

function tempestReady(s: SimAPI): boolean {
  return s.auraRemains('player', 'tempest_proc') > 0
}

export const enhancementShaman: SpecConfig = {
  name: 'Enhancement Shaman',
  specId: 'shaman-enhancement',
  specIcon: 'spell_shaman_improvedstormstrike',
  resourceName: 'Maelstrom Weapon',
  resourceMax: 10,
  startingResource: 0,

  onCombatStart: (s) => {
    // dual-wield autos: hasted; each swing builds Maelstrom and rolls
    // Windfury (doubled-up under Doom Winds) and Hot Hand
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      s.gain(1, 'auto_msw')
      const wfChance = s.auraRemains('player', 'doom_winds') > 0 ? WF_DOOM_CHANCE : WF_CHANCE
      if (s.rng('windfury') < wfChance) s.damage('Windfury', WF_COEFF)
      if (s.rng('hot_hand') < HOT_HAND_CHANCE) s.applyAura('player', 'hot_hand')
      s.schedule(s.time + SWING_TIME * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'stormsurge', name: 'Stormsurge', icon: 'spell_nature_stormreach', duration: 12 },
    { id: 'hot_hand', name: 'Hot Hand', icon: 'spell_fire_playingwithfire', duration: 8 },
    { id: 'tempest_proc', name: 'Tempest', icon: 'spell_nature_callstorm', duration: 25 },
    { id: 'doom_winds', name: 'Doom Winds', icon: 'spell_nature_cyclone', duration: 8 },
    {
      id: 'feral_spirits', name: 'Feral Spirits', icon: 'spell_shaman_feralspirit', duration: 15,
      tick: {
        interval: 1.5, hasted: false,
        onTick: (s) => {
          s.damage('Feral Spirit', WOLF_PULSE)
          s.gain(1, 'feral_spirits')
        },
      },
    },
    {
      id: 'flame_shock', name: 'Flame Shock', icon: 'spell_fire_flameshock', duration: 18, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('flame_shock', FS_TICK) },
    },
  ],

  abilities: [
    {
      id: 'stormstrike',
      name: 'Stormstrike',
      icon: 'ability_shaman_stormstrike',
      spellId: 17364,
      cooldown: 7.5,
      noCooldownIf: (s) => s.auraRemains('player', 'stormsurge') > 0,
      onResolve: (s) => {
        if (s.auraRemains('player', 'stormsurge') > 0) s.removeAura('player', 'stormsurge')
        s.damage('stormstrike', SS_COEFF)
        s.gain(2, 'stormstrike')
        // Stormsurge rides the real crit chance (stat-scaling)
        if (s.rng('stormsurge') < s.stats.critChance) s.applyAura('player', 'stormsurge')
      },
    },
    {
      id: 'lava_lash',
      name: 'Lava Lash',
      icon: 'ability_shaman_lavalash',
      spellId: 60103,
      cooldown: 9,
      noCooldownIf: (s) => s.auraRemains('player', 'hot_hand') > 0, // Hot Hand: spam window
      onResolve: (s) => {
        const hot = s.auraRemains('player', 'hot_hand') > 0
        s.damage('lava_lash', LL_COEFF * (hot ? HOT_HAND_MULT : 1), { tags: ['fire'] })
        s.gain(1, 'lava_lash')
      },
    },
    {
      // One button, as in game: a charged Tempest transforms Lightning Bolt.
      id: 'lightning_bolt',
      name: 'Lightning Bolt',
      icon: 'spell_nature_lightning',
      spellId: 188196,
      displayName: (s) => (tempestReady(s) ? 'Tempest' : 'Lightning Bolt'),
      displayIcon: (s) => (tempestReady(s) ? 'spell_nature_callstorm' : 'spell_nature_lightning'),
      usable: (s) => (s.insanity >= 5 ? true : 'needs 5+ Maelstrom Weapon'),
      onResolve: (s) => {
        const n = spendMsw(s)
        s.spend(n)
        if (tempestReady(s)) {
          s.removeAura('player', 'tempest_proc')
          s.damage('Tempest', TEMPEST_COEFF * (1 + 0.05 * (n - 5)))
          s.applyAura('player', 'stormsurge') // Apex: Storm's Legacy
        } else {
          s.damage('lightning_bolt', LB_PER_MSW * n)
        }
      },
    },
    {
      id: 'elemental_blast',
      name: 'Elemental Blast',
      icon: 'shaman_talent_elementalblast',
      spellId: 117014,
      cooldown: 15,
      usable: (s) => (s.insanity >= 5 ? true : 'needs 5+ Maelstrom Weapon'),
      onResolve: (s) => {
        const n = spendMsw(s)
        s.spend(n)
        s.damage('elemental_blast', EB_PER_MSW * n)
      },
    },
    {
      id: 'flame_shock',
      name: 'Flame Shock',
      icon: 'spell_fire_flameshock',
      spellId: 188389,
      cooldown: 6,
      onResolve: (s) => {
        s.damage('flame_shock', FS_DIRECT, { tags: ['fire'] })
        s.applyAura('target', 'flame_shock')
      },
    },
    {
      id: 'feral_spirits',
      name: 'Feral Spirits',
      icon: 'spell_shaman_feralspirit',
      spellId: 51533,
      cooldown: 90,
      onResolve: (s) => {
        s.applyAura('player', 'feral_spirits')
        s.applyAura('player', 'stormsurge') // S2 4pc
      },
    },
    {
      id: 'doom_winds',
      name: 'Doom Winds',
      icon: 'spell_nature_cyclone',
      spellId: 384352,
      cooldown: 60,
      onResolve: (s) => s.applyAura('player', 'doom_winds'),
    },
  ],

  actionBar: [
    'stormstrike', 'lava_lash', 'lightning_bolt', 'elemental_blast',
    'flame_shock', 'feral_spirits', 'doom_winds',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'stormstrike': return s.auraRemains('player', 'stormsurge') > 0
      case 'lava_lash': return s.auraRemains('player', 'hot_hand') > 0
      case 'lightning_bolt': return tempestReady(s) && s.insanity >= 5
      case 'elemental_blast': return s.insanity >= 8
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'feral_spirits', text: 'On cooldown — wolves feed Maelstrom', when: s => s.cooldownRemains('feral_spirits') === 0 },
    { abilityId: 'doom_winds', text: 'On cooldown — Windfury storm window', when: s => s.cooldownRemains('doom_winds') === 0 },
    { abilityId: 'lightning_bolt', label: 'Tempest', icon: 'spell_nature_callstorm', text: 'Charged Tempest at 5+ Maelstrom', when: s => tempestReady(s) && s.insanity >= 5 },
    { abilityId: 'elemental_blast', text: 'At 8-10 Maelstrom — never sit capped', when: s => s.insanity >= 8 && s.cooldownRemains('elemental_blast') === 0 },
    { abilityId: 'lightning_bolt', text: 'At 8-10 Maelstrom when Elemental Blast is down' },
    { abilityId: 'flame_shock', text: 'Keep the DoT rolling (refresh under 5.4s)' },
    { abilityId: 'lava_lash', text: 'Hot Hand windows — spam it', when: s => s.auraRemains('player', 'hot_hand') > 0 },
    { abilityId: 'stormstrike', text: 'On cooldown; Stormsurge procs reset it', when: s => s.cooldownRemains('stormstrike') === 0 || s.auraRemains('player', 'stormsurge') > 0 },
    { abilityId: 'lava_lash', text: 'On cooldown' },
  ],

  policy: (s) => {
    const msw = s.insanity
    const fsRemains = s.auraRemains('target', 'flame_shock')

    if (fsRemains <= 0 && s.isUsable('flame_shock') === true) return 'flame_shock'
    if (s.cooldownRemains('feral_spirits') === 0) return 'feral_spirits'
    if (s.cooldownRemains('doom_winds') === 0) return 'doom_winds'
    if (tempestReady(s) && msw >= 5) return 'lightning_bolt'
    if (msw >= 8) {
      if (s.isUsable('elemental_blast') === true && s.timeToUsable('elemental_blast') === 0) return 'elemental_blast'
      return 'lightning_bolt'
    }
    if (fsRemains < 5.4 && s.isUsable('flame_shock') === true) return 'flame_shock'
    if (s.auraRemains('player', 'hot_hand') > 0) return 'lava_lash'
    if (s.cooldownRemains('stormstrike') === 0 || s.auraRemains('player', 'stormsurge') > 0) return 'stormstrike'
    if (s.cooldownRemains('lava_lash') === 0) return 'lava_lash'
    return null // pool Maelstrom for the next spender
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const spenders = ['lightning_bolt', 'elemental_blast']
    const strikes = ['stormstrike', 'lava_lash']
    const sets = [spenders, strikes]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
