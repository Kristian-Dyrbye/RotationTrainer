import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Devastation Evoker — patch 12.1.0 (Midnight, Season 2), Flameshaper raid
 * pure-ST build (alternate to the default Scalecommander build). Guides rate
 * Scalecommander "best choice" for raid; Flameshaper is comparable only in
 * pure single target, which is exactly what this trainer models.
 *
 * Sources (verified 2026-08-24):
 * - Wowhead rotation guide:
 *   https://www.wowhead.com/guide/classes/evoker/devastation/rotation-cooldowns-pve-dps
 * - Icy Veins rotation ("Flameshaper Opener/Rotation" sections):
 *   https://www.icy-veins.com/wow/devastation-evoker-pve-dps-rotation-cooldowns-abilities
 * - Method playstyle + talents (12.1, updated 17 Aug 2026; the "Flameshaper
 *   ST" import string is published verbatim on the talents page):
 *   https://www.method.gg/guides/devastation-evoker/playstyle-and-rotation
 *   https://www.method.gg/guides/devastation-evoker/talents
 *
 * 12.1 Flameshaper shape (Engulf is GONE — the tree was reworked):
 * - You gain a SECOND CHARGE of Fire Breath. Never sit at 2 charges, and
 *   stagger the casts to keep the dot up ("maximize the damage over time
 *   portion to use with Consume Flame").
 * - Consume Flame (capstone): each Disintegrate cast consumes 2 seconds of
 *   the Fire Breath dot and detonates it for 150% of that damage. This makes
 *   the build hungry for Fire Breath dot uptime, and Fire Breath is always
 *   cast at RANK 1 to maximize dot length (Icy Veins: "always at Empower
 *   level 1 to maximize the damage of Consume Flame").
 * - Essence Well: Fire Breath has a 50% chance to grant Essence Burst.
 * - Twin Flame: consuming an Essence Burst sends out an extra hit.
 * - Titanic Precision: Living Flame/Azure Strike crits fish extra Essence
 *   Bursts (folded into the proc chance riding crit).
 * - No rotational Deep Breath (that is Scalecommander's Melt Armor/Imminent
 *   Destruction package); Dragonrage/Rising Fury/Unbound Flame (Apex) and
 *   the Eternity Surge -> Azure Sweep/Shattering Stars core are shared.
 *
 * Priority (Icy Veins "Flameshaper Rotation", matches Method): Dragonrage on
 * cooldown -> Fire Breath rank 1 (second charge when the dot is nearly
 * consumed, never 2 charges banked) -> Eternity Surge on cooldown ->
 * Disintegrate as the Essence spender -> Unbound Flame after Dragonrage ->
 * Azure Sweep when available -> Living Flame filler (Azure Strike moving).
 *
 * S2 tier: 2pc Shattering Stars +50%, always max-empower (folded into the
 * coefficient); 4pc Causality reduction +0.1s/tick (folded into the 0.6s
 * per Disintegrate tick) and Eternity Surge +10% (folded).
 *
 * Resource model: Essence (max 5), 1 regenerated every 5s (hasted).
 * Essence Burst procs make Disintegrate free (consumed on its first tick).
 * APPROX list: rank-1 empowers modeled at a 1.0s cast; Fire Breath dot at
 * 24s (Flameshaper "increases the damage and length of your fire breath"
 * talents folded in); Consume Flame modeled as an instant detonation on
 * Disintegrate cast that shortens the dot by 2s; Rising Fury pacing (stack
 * per 4s of a 20s Dragonrage); Azure Sweep guaranteed Essence Burst;
 * Titanic Precision folded into filler proc chances; proc rates and all
 * coefficients are sane relative magnitudes in SP units, not sims.
 */

const LF_COEFF = 1.0
const AZ_COEFF = 0.55
const SWEEP_MULT = 1.75       // Azure Sweep: +75% Azure Strike damage
const DISINT_TICK = 0.95      // 4 ticks over 3s
const FB_DIRECT = 0.8         // rank 1: light upfront hit...
const FB_TICK = 0.4           // ...long dot: every 2s over 24s
const CONSUME_MULT = 1.5      // Consume Flame: 150% of the consumed dot
const CONSUME_SECONDS = 2     // seconds of Fire Breath eaten per Disintegrate
const ES_COEFF = 3.3          // incl. S2 4pc +10%
const STARS_COEFF = 1.6       // Shattering Stars passive, incl. S2 2pc
const TWIN_FLAME_COEFF = 0.3  // extra hit when an Essence Burst is consumed
const UNBOUND_COEFF = 1.1
const DR_MULT = 1.1
const RISEN_FURY_MULT = 1.15  // at 5 Rising Fury stacks
const CAUSALITY_CDR = 0.6     // per Disintegrate tick, incl. S2 4pc +0.1
const EB_BASE_CHANCE = 0.15   // + crit chance (Titanic Precision), per filler
const ESSENCE_WELL_CHANCE = 0.5 // Essence Burst per Fire Breath cast

function ebUp(s: SimAPI): number {
  return s.stacks('player', 'essence_burst')
}

function sweepReady(s: SimAPI): number {
  return s.stacks('player', 'azure_sweep')
}

/** Consume Flame: eat 2s of the Fire Breath dot and detonate it. */
function consumeFlame(s: SimAPI) {
  const remains = s.auraRemains('target', 'fire_breath_dot')
  if (remains <= 0) return
  const eaten = Math.min(CONSUME_SECONDS, remains)
  // 2s of dot = one 2s tick; detonate at 150% of that damage
  s.damage('consume_flame', CONSUME_MULT * FB_TICK * (eaten / 2), { tags: ['fire'] })
  const left = remains - eaten
  // reapply shorter rather than mutating expiry (keeps uptime bookkeeping exact)
  s.removeAura('target', 'fire_breath_dot')
  if (left > 0.05) s.applyAura('target', 'fire_breath_dot', { duration: left })
}

export const devastationFlameshaper: SpecConfig = {
  name: 'Devastation Evoker',
  specId: 'evoker-devastation',
  specIcon: 'classicon_evoker_devastation',
  buildId: 'flameshaper',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/evoker/devastation/rotation-cooldowns-pve-dps',
    buildName: 'Flameshaper ST (Method raid single-target build)',
    heroTalent: 'Flameshaper',
    // published verbatim on method.gg/guides/devastation-evoker/talents ("Flameshaper ST")
    talentString: 'CsbBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAzMDmZYGzMgBjZamZmJzM2GmZGmZmZGwMmxYmZZmZwMwMmBWALgZYCsBWGGAzMDD',
    retrieved: '2026-08-24',
  },
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
      id: 'fire_breath_dot', name: 'Fire Breath', icon: 'ability_evoker_firebreath', duration: 24, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('fire_breath_dot', FB_TICK, { tags: ['fire'] }) },
    },
    // next Azure Strikes become Azure Sweep (granted by Eternity Surge)
    { id: 'azure_sweep', name: 'Azure Sweep', icon: 'spell_arcane_arcanetorrent', duration: 20, maxStacks: 2 },
    {
      id: 'rising_fury', name: 'Rising Fury', icon: 'ability_evoker_dragonrage2', duration: 30, maxStacks: 5,
    },
    // Apex rank 4: charges granted when Dragonrage ends
    { id: 'unbound_flame', name: 'Unbound Flame', icon: 'spell_fire_felflamering_red', duration: 25, maxStacks: 4 },
    {
      id: 'dragonrage', name: 'Dragonrage', icon: 'ability_evoker_dragonrage', duration: 20,
      // Rising Fury stacks up while raging (APPROX pacing: 1 per 4s, 5 max)
      tick: { interval: 4, hasted: false, onTick: s => s.applyAura('player', 'rising_fury', { stacks: 1 }) },
      onExpire: (s) => {
        // Rising Fury persists 4s per stack; Apex grants 4 Unbound Flames
        const n = s.stacks('player', 'rising_fury')
        if (n > 0) s.applyAura('player', 'rising_fury', { duration: 4 * n })
        s.applyAura('player', 'unbound_flame', { stacks: 4 })
      },
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
        // Titanic Precision: crits fish extra Essence Bursts (folded into chance)
        if (s.rng('essence_burst') < EB_BASE_CHANCE + s.stats.critChance) {
          s.applyAura('player', 'essence_burst', { stacks: 1 })
        }
      },
    },
    {
      id: 'azure_strike',
      name: 'Azure Strike',
      icon: 'ability_evoker_azurestrike',
      spellId: 362969,
      displayName: (s) => (sweepReady(s) > 0 ? 'Azure Sweep' : 'Azure Strike'),
      displayIcon: (s) => (sweepReady(s) > 0 ? 'spell_arcane_arcanetorrent' : 'ability_evoker_azurestrike'),
      displayStacks: (s) => sweepReady(s),
      onResolve: (s) => {
        if (sweepReady(s) > 0) {
          s.consumeStack('player', 'azure_sweep')
          s.damage('azure_sweep', AZ_COEFF * SWEEP_MULT, { tags: ['arcane'] })
          s.applyAura('player', 'essence_burst', { stacks: 1 }) // APPROX: guaranteed
        } else {
          s.damage('azure_strike', AZ_COEFF, { tags: ['arcane'] })
          // Titanic Precision: Azure Strike crits can grant Essence Burst
          if (s.rng('essence_burst') < s.stats.critChance * 0.5) {
            s.applyAura('player', 'essence_burst', { stacks: 1 })
          }
        }
      },
    },
    {
      id: 'disintegrate',
      name: 'Disintegrate',
      icon: 'ability_evoker_disintegrate',
      spellId: 356995,
      cost: 3,
      costMod: (s) => (ebUp(s) > 0 ? 0 : 3),
      // Consume Flame: the cast eats 2s of the Fire Breath dot and detonates it
      onCastStart: (s) => consumeFlame(s),
      channel: {
        duration: 3,
        ticks: 4,
        hasted: true,
        onTick: (s, i) => {
          // an Essence Burst is consumed as the beam settles (first tick)
          if (i === 1 && ebUp(s) > 0) {
            s.consumeStack('player', 'essence_burst')
            // Twin Flame: consuming an Essence Burst sends out an extra hit
            s.damage('twin_flame', TWIN_FLAME_COEFF, { tags: ['fire'] })
          }
          s.damage('disintegrate', DISINT_TICK, { tags: ['arcane'] })
          // Causality (+ S2 4pc): each tick shaves the empower cooldowns
          s.reduceCooldown('fire_breath', CAUSALITY_CDR)
          s.reduceCooldown('eternity_surge', CAUSALITY_CDR)
        },
      },
      onResolve: () => {},
    },
    {
      id: 'fire_breath',
      name: 'Fire Breath',
      icon: 'ability_evoker_firebreath',
      spellId: 357208,
      castTime: 1.0, // rank 1 empower — released immediately (longest dot)
      cooldown: 30,
      charges: 2,    // Flameshaper: an additional charge of Fire Breath
      displayStacks: (s) => s.chargesOf('fire_breath'),
      onResolve: (s) => {
        s.damage('fire_breath', FB_DIRECT, { tags: ['fire'] })
        s.applyAura('target', 'fire_breath_dot')
        // Essence Well: 50% chance to grant Essence Burst on cast
        if (s.rng('essence_well') < ESSENCE_WELL_CHANCE) {
          s.applyAura('player', 'essence_burst', { stacks: 1 })
        }
      },
    },
    {
      id: 'eternity_surge',
      name: 'Eternity Surge',
      icon: 'ability_evoker_eternitysurge',
      spellId: 359073,
      castTime: 1.0, // rank 1 empower — released immediately
      cooldown: 30,
      onResolve: (s) => {
        s.damage('eternity_surge', ES_COEFF, { tags: ['arcane'] })
        // Shattering Stars passive (S2 2pc: +50%, always max empower)
        s.damage('shattering_stars', STARS_COEFF, { tags: ['arcane'] })
        // next two Azure Strikes become Azure Sweep
        s.applyAura('player', 'azure_sweep', { stacks: 2 })
      },
    },
    {
      id: 'unbound_flame',
      name: 'Unbound Flame',
      icon: 'spell_fire_felflamering_red',
      displayStacks: (s) => s.stacks('player', 'unbound_flame'),
      usable: (s) => (s.stacks('player', 'unbound_flame') > 0 ? true : 'no Unbound Flame charges'),
      onResolve: (s) => {
        s.consumeStack('player', 'unbound_flame')
        s.damage('unbound_flame', UNBOUND_COEFF, { tags: ['fire'] })
        s.applyAura('player', 'essence_burst', { stacks: 1 })
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
        s.applyAura('player', 'essence_burst', { stacks: 1 })
      },
    },
  ],

  actionBar: [
    'living_flame', 'azure_strike', 'disintegrate', 'fire_breath',
    'eternity_surge', 'unbound_flame', 'dragonrage',
  ],

  hasteMod: (s) => 0.04 * s.stacks('player', 'rising_fury'),

  damageMult: (s) => {
    let m = 1
    if (s.auraRemains('player', 'dragonrage') > 0) m *= DR_MULT
    if (s.stacks('player', 'rising_fury') >= 5) m *= RISEN_FURY_MULT
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'disintegrate': return ebUp(s) > 0
      case 'azure_strike': return sweepReady(s) > 0
      case 'unbound_flame': return s.stacks('player', 'unbound_flame') > 0
      case 'fire_breath': return s.chargesOf('fire_breath') === 2
        || (s.chargesOf('fire_breath') > 0 && s.auraRemains('target', 'fire_breath_dot') < 4)
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'dragonrage', text: 'On cooldown — stack Rising Fury to 5 while it runs', when: s => s.cooldownRemains('dragonrage') === 0 },
    { abilityId: 'fire_breath', text: 'Rank 1 — recast as Consume Flame eats the dot; never sit at 2 charges', when: s => s.chargesOf('fire_breath') === 2 || (s.chargesOf('fire_breath') > 0 && s.auraRemains('target', 'fire_breath_dot') < 4) },
    { abilityId: 'eternity_surge', text: 'Rank 1 on cooldown — fires a Shattering Star (2pc), loads Azure Sweep', when: s => s.cooldownRemains('eternity_surge') === 0 },
    { abilityId: 'disintegrate', text: 'Essence Burst or 3+ Essence — each cast detonates 2s of Fire Breath (Consume Flame)', when: s => ebUp(s) > 0 || s.insanity >= 3 },
    { abilityId: 'unbound_flame', text: 'Spend the 4 post-Dragonrage charges when low on Essence with no Burst', when: s => s.stacks('player', 'unbound_flame') > 0 },
    { abilityId: 'azure_strike', label: 'Azure Sweep', icon: 'spell_arcane_arcanetorrent', text: 'Azure Sweep stacks from Eternity Surge — grants Essence Burst', when: s => sweepReady(s) > 0 },
    { abilityId: 'living_flame', text: 'Filler — fishes for Essence Burst (Azure Strike on the move)' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Disintegrate

    if (s.cooldownRemains('dragonrage') === 0) return 'dragonrage'
    if (s.chargesOf('fire_breath') === 2
      || (s.chargesOf('fire_breath') > 0 && s.auraRemains('target', 'fire_breath_dot') < 4)) return 'fire_breath'
    if (s.cooldownRemains('eternity_surge') === 0) return 'eternity_surge'
    if (ebUp(s) > 0 || s.insanity >= 3) return 'disintegrate'
    if (s.stacks('player', 'unbound_flame') > 0) return 'unbound_flame'
    if (sweepReady(s) > 0) return 'azure_strike'
    return 'living_flame'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const empowers = ['fire_breath', 'eternity_surge']
    const fillers = ['living_flame', 'disintegrate', 'azure_strike', 'unbound_flame']
    const sets = [empowers, fillers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
