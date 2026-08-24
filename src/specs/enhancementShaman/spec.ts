import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Enhancement Shaman — patch 12.1.0 (Midnight, Season 2), Stormbringer raid
 * ST build with the S2 "Ophidian Oracle's Prophecy" tier 2pc+4pc.
 * Sources (verified 2026-08-24):
 *  - Icy Veins rotation: icy-veins.com/wow/enhancement-shaman-pve-dps-rotation-cooldowns-abilities
 *  - Icy Veins builds (talent string): icy-veins.com/wow/enhancement-shaman-pve-dps-spec-builds-talents
 *  - Method: method.gg/guides/enhancement-shaman/playstyle-and-rotation
 *
 * Resource model: Maelstrom Weapon (max 10) as the primary bar — built by
 * dual-wield autos, Stormstrike, Lava Lash, Crash Lightning, and Static
 * Accumulation during Doom Winds; spent at 10 (5+ as last-resort filler) on
 * instant Tempest / Lightning Bolt. Mana is not modeled.
 * Stat links: swing speed is hasted (more autos → more Maelstrom, Windfury
 * and Hot Hand rolls); direct damage crits are expected-value via the engine.
 * Talent assumptions (Icy Veins "Raid / Single Target - Stormbringer"):
 * Voltaic Blaze (replaces Flame Shock upkeep), Crash Lightning, Ascendance
 * with Descending Skies (grants a Tempest; Stormstrike becomes Windstrike),
 * Doom Winds + Thorim's Invocation (free bolts while filling the window),
 * Elemental Tempo (spenders CDR the strikes), Thunder Capacitor (20% full
 * Maelstrom refund on Lightning Bolt), Hot Hand, Stormbringer — every 40
 * Maelstrom spent charges a Tempest that transforms the Lightning Bolt
 * button; Apex: Storm Unleashed 4/4 (folded into Crash/Tempest coefficients).
 * S2 tier: 2pc Voltaic Blaze erupts a Fire Nova on the target every 2s for
 * 6s (200% to primary folded in); 4pc each Fire Nova pulse reduces Crash
 * Lightning's cooldown by 2s and charges it +8%, stacking to 5.
 * APPROX-flagged: proc rates, auto cadence, per-stack spender scaling,
 * Voltaic Blaze / Crash Lightning cooldowns, Elemental Tempo CDR amount.
 * Damage in AP units.
 */

const AUTO_COEFF = 0.30
const SWING_TIME = 1.4          // APPROX combined DW stream
const WF_COEFF = 0.55
const WF_CHANCE = 0.20
const WF_DOOM_CHANCE = 0.60     // during Doom Winds
const HOT_HAND_CHANCE = 0.05    // APPROX per swing
const SS_COEFF = 1.4            // both hands
const WINDSTRIKE_MULT = 1.3     // Ascendance-transformed Stormstrike
const LL_COEFF = 1.05
const HOT_HAND_MULT = 1.4
const LB_PER_MSW = 0.19         // APPROX per stack spent
const TEMPEST_COEFF = 2.8
const VB_DIRECT = 1.2
const FIRE_NOVA = 0.55          // APPROX per 2pc pulse, 200%-to-primary folded in
const CRASH_COEFF = 1.15
const CRASH_PER_STACK = 0.08    // 4pc: +8% per Fire Nova charge, max 5
const THORIM_BOLT = 0.8         // APPROX Thorim's Invocation free bolt
const FS_TICK = 0.30
const TEMPEST_THRESHOLD = 40    // Maelstrom spent per Tempest
const TC_REFUND_CHANCE = 0.20   // Thunder Capacitor
const TEMPO_CDR = 0.3           // APPROX Elemental Tempo: strike CDR per stack spent

function spendMsw(s: SimAPI): number {
  const n = Math.min(10, Math.floor(s.insanity))
  s.data.msw_total = (s.data.msw_total ?? 0) + n
  // Stormbringer: every 40 Maelstrom spent charges a Tempest
  if (s.data.msw_total >= TEMPEST_THRESHOLD) {
    s.data.msw_total -= TEMPEST_THRESHOLD
    s.applyAura('player', 'tempest_proc')
  }
  // Elemental Tempo: spenders feed cooldown reduction back to the strikes
  for (const id of ['stormstrike', 'lava_lash', 'crash_lightning']) {
    s.reduceCooldown(id, TEMPO_CDR * n)
  }
  return n
}

function tempestReady(s: SimAPI): boolean {
  return s.auraRemains('player', 'tempest_proc') > 0
}

function ascUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'ascendance') > 0
}

function doomUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'doom_winds') > 0
}

/** Thorim's Invocation: strikes thrown during Doom Winds fire a free bolt */
function thorimBolt(s: SimAPI) {
  if (doomUp(s)) s.damage("Thorim's Invocation", THORIM_BOLT)
}

export const enhancementShaman: SpecConfig = {
  name: 'Enhancement Shaman',
  specId: 'shaman-enhancement',
  specIcon: 'spell_shaman_improvedstormstrike',
  resourceName: 'Maelstrom Weapon',
  resourceMax: 10,
  startingResource: 0,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/shaman/enhancement/rotation-cooldowns-pve-dps',
    buildName: 'Stormbringer Raid ST',
    heroTalent: 'Stormbringer',
    // Icy Veins "Raid / Single Target - Stormbringer" import code
    talentString: 'CcQAAAAAAAAAAAAAAAAAAAAAAMzMzgZmZmZmhZmZAAAAAAAAA2AsZGDbwCMDDNYBgZZGzMjllZgZmNWmZmZYYMDAwMMmZMzEYmBDGDA',
    retrieved: '2026-08-24',
  },

  onCombatStart: (s) => {
    // dual-wield autos: hasted; each swing builds Maelstrom and rolls
    // Windfury (tripled-up under Doom Winds) and Hot Hand
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      s.gain(1, 'auto_msw')
      const wfChance = doomUp(s) ? WF_DOOM_CHANCE : WF_CHANCE
      if (s.rng('windfury') < wfChance) s.damage('Windfury', WF_COEFF)
      if (s.rng('hot_hand') < HOT_HAND_CHANCE) s.applyAura('player', 'hot_hand')
      s.schedule(s.time + SWING_TIME * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'hot_hand', name: 'Hot Hand', icon: 'spell_fire_playingwithfire', duration: 8 },
    { id: 'tempest_proc', name: 'Tempest', icon: 'spell_nature_callstorm', duration: 25 },
    {
      id: 'doom_winds', name: 'Doom Winds', icon: 'spell_nature_cyclone', duration: 8,
      // Static Accumulation: the window floods Maelstrom Weapon
      tick: { interval: 1, hasted: false, onTick: s => s.gain(1, 'static_accumulation') },
    },
    { id: 'ascendance', name: 'Ascendance', icon: 'spell_fire_elementaldevastation', duration: 15 },
    // S2 4pc: Fire Nova pulses charge the next Crash Lightning, +8% each
    { id: 'charged_crash', name: 'Charged Crash Lightning', icon: 'spell_shaman_crashlightning', duration: 30, maxStacks: 5 },
    {
      id: 'flame_shock', name: 'Flame Shock', icon: 'spell_fire_flameshock', duration: 18, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('flame_shock', FS_TICK) },
    },
  ],

  abilities: [
    {
      id: 'voltaic_blaze',
      name: 'Voltaic Blaze',
      icon: 'inv_10_dungeonjewelry_primalist_trinket_1ragingelement_fire',
      spellId: 470057,
      cooldown: 15, // APPROX
      onResolve: (s) => {
        s.damage('voltaic_blaze', VB_DIRECT, { tags: ['fire'] })
        s.applyAura('target', 'flame_shock')
        s.gain(1, 'voltaic_blaze')
        // S2 2pc: the target erupts in a Fire Nova every 2s for 6s;
        // 4pc: each pulse hastens and charges Crash Lightning
        for (const delay of [2, 4, 6]) {
          s.schedule(s.time + delay, () => {
            s.damage('Fire Nova', FIRE_NOVA, { tags: ['fire'] })
            s.reduceCooldown('crash_lightning', 2)
            s.applyAura('player', 'charged_crash', { stacks: 1 })
          })
        }
      },
    },
    {
      id: 'crash_lightning',
      name: 'Crash Lightning',
      icon: 'spell_shaman_crashlightning',
      spellId: 187874,
      cooldown: 12, // APPROX; Fire Nova (4pc) and Elemental Tempo pull it down hard
      onResolve: (s) => {
        const stacks = s.stacks('player', 'charged_crash')
        if (stacks > 0) s.removeAura('player', 'charged_crash')
        s.damage('crash_lightning', CRASH_COEFF * (1 + CRASH_PER_STACK * stacks))
        s.gain(1, 'crash_lightning')
        thorimBolt(s)
      },
    },
    {
      // Ascendance transforms Stormstrike into cooldown-free Windstrike
      id: 'stormstrike',
      name: 'Stormstrike',
      icon: 'ability_shaman_stormstrike',
      spellId: 17364,
      cooldown: 7.5,
      displayName: (s) => (ascUp(s) ? 'Windstrike' : 'Stormstrike'),
      displayIcon: (s) => (ascUp(s) ? 'ability_skyreach_four_wind' : 'ability_shaman_stormstrike'),
      noCooldownIf: (s) => ascUp(s),
      onResolve: (s) => {
        s.damage('stormstrike', SS_COEFF * (ascUp(s) ? WINDSTRIKE_MULT : 1))
        s.gain(2, 'stormstrike')
        thorimBolt(s)
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
        } else {
          s.damage('lightning_bolt', LB_PER_MSW * n)
        }
        // Thunder Capacitor: 20% to refund everything spent
        if (s.rng('thunder_capacitor') < TC_REFUND_CHANCE) s.gain(n, 'thunder_capacitor')
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
    {
      id: 'ascendance',
      name: 'Ascendance',
      icon: 'spell_fire_elementaldevastation',
      spellId: 114051,
      cooldown: 120,
      onResolve: (s) => {
        s.applyAura('player', 'ascendance')
        s.applyAura('player', 'tempest_proc') // Descending Skies: Ascendance grants a Tempest
      },
    },
  ],

  actionBar: [
    'stormstrike', 'crash_lightning', 'lava_lash', 'lightning_bolt',
    'voltaic_blaze', 'doom_winds', 'ascendance',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'stormstrike': return ascUp(s) || doomUp(s)
      case 'crash_lightning': return s.stacks('player', 'charged_crash') >= 5
      case 'lava_lash': return s.auraRemains('player', 'hot_hand') > 0
      case 'lightning_bolt': return tempestReady(s) && s.insanity >= 10
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'voltaic_blaze', text: 'On cooldown — applies Flame Shock; 2pc Fire Nova eruption', when: s => s.isUsable('voltaic_blaze') === true },
    { abilityId: 'doom_winds', text: 'On cooldown — Windfury + Static Accumulation window', when: s => s.isUsable('doom_winds') === true },
    { abilityId: 'ascendance', text: 'On cooldown — 2-minute burst; grants a Tempest', when: s => s.isUsable('ascendance') === true },
    { abilityId: 'crash_lightning', text: 'Whenever available — 4pc Fire Nova charges make it hit hard', when: s => s.isUsable('crash_lightning') === true },
    { abilityId: 'stormstrike', label: 'Windstrike', icon: 'ability_skyreach_four_wind', text: 'Fill Doom Winds / Ascendance — Thorim’s Invocation bolts', when: s => (doomUp(s) || ascUp(s)) && s.isUsable('stormstrike') === true },
    { abilityId: 'lightning_bolt', label: 'Tempest', icon: 'spell_nature_callstorm', text: 'Charged Tempest at 10 Maelstrom Weapon', when: s => tempestReady(s) && s.insanity >= 10 },
    { abilityId: 'lightning_bolt', text: 'Lightning Bolt at 10 Maelstrom Weapon — never overcap', when: s => !tempestReady(s) && s.insanity >= 10 },
    { abilityId: 'lava_lash', text: 'Hot Hand windows — spam it', when: s => s.auraRemains('player', 'hot_hand') > 0 },
    { abilityId: 'stormstrike', text: 'On cooldown — main filler' },
    { abilityId: 'lava_lash', text: 'Last-resort builder' },
    { abilityId: 'lightning_bolt', text: 'At 5+ Maelstrom Weapon when everything else is down' },
  ],

  policy: (s) => {
    const msw = s.insanity

    if (s.isUsable('voltaic_blaze') === true) return 'voltaic_blaze'
    if (s.isUsable('doom_winds') === true) return 'doom_winds'
    if (s.isUsable('ascendance') === true) return 'ascendance'
    if (s.isUsable('crash_lightning') === true) return 'crash_lightning'
    if ((doomUp(s) || ascUp(s)) && s.isUsable('stormstrike') === true) return 'stormstrike'
    if (msw >= 10) return 'lightning_bolt'
    if (s.auraRemains('player', 'hot_hand') > 0 && s.isUsable('lava_lash') === true) return 'lava_lash'
    if (s.isUsable('stormstrike') === true) return 'stormstrike'
    if (s.isUsable('lava_lash') === true) return 'lava_lash'
    if (msw >= 5) return 'lightning_bolt'
    return null // pool Maelstrom for the next spender
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const strikes = ['stormstrike', 'lava_lash', 'crash_lightning']
    return strikes.includes(pressed) && strikes.includes(oracle)
  },
}
