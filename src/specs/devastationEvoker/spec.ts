import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Devastation Evoker — patch 12.1.0 (Midnight, Season 2), Scalecommander
 * raid ST build. Scalecommander is the recommended hero talent for raid on
 * every boss in 12.1 (Flameshaper only comparable in pure ST).
 *
 * Sources (verified 2026-08-24):
 * - Wowhead rotation guide:
 *   https://www.wowhead.com/guide/classes/evoker/devastation/rotation-cooldowns-pve-dps
 * - Icy Veins rotation + builds:
 *   https://www.icy-veins.com/wow/devastation-evoker-pve-dps-rotation-cooldowns-abilities
 *   https://www.icy-veins.com/wow/devastation-evoker-pve-dps-spec-builds-talents
 * - Method playstyle guide:
 *   https://www.method.gg/guides/devastation-evoker/playstyle-and-rotation
 *
 * 12.1 rotation shape: Deep Breath is a rotational cooldown (Strafing Run
 * recast; grants Imminent Destruction, applies Melt Armor). Fire Breath and
 * Eternity Surge are cast at RANK 1 on cooldown. Shattering Star is gone as
 * a button — the Shattering Stars passive fires one automatically on every
 * Eternity Surge. Eternity Surge turns the next 2 Azure Strikes into Azure
 * Sweep. Dragonrage stacks Rising Fury (haste, then a damage amp at 5);
 * when it ends, the Apex rank-4 talent grants 4 Unbound Flame charges to
 * spend while Rising Fury persists.
 *
 * S2 tier: 2pc Shattering Stars +50%, always max-empower (folded into the
 * coefficient); 4pc Causality reduction +0.1s/tick (folded into the 0.6s
 * per Disintegrate tick) and Eternity Surge +10% (folded).
 *
 * Resource model: Essence (max 5), 1 regenerated every 5s (hasted).
 * Essence Burst procs make Disintegrate free (consumed on its first tick).
 * APPROX list: rank-1 empowers modeled at a 1.0s cast; Deep Breath's
 * Strafing Run recast modeled as a 2nd charge; Imminent Destruction as a
 * 3-stack cost/damage buff; Rising Fury pacing (stack per 4s of a 20s
 * Dragonrage); Azure Sweep guaranteed Essence Burst; Mass Disintegrate /
 * Bombardments cleave unmodeled (single-target dummy); proc rates and all
 * coefficients are sane relative magnitudes in SP units, not sims.
 */

const LF_COEFF = 1.0
const AZ_COEFF = 0.55
const SWEEP_MULT = 1.75       // Azure Sweep: +75% Azure Strike damage
const DISINT_TICK = 0.95      // 4 ticks over 3s
const ID_DISINT_MULT = 1.15   // Imminent Destruction: empowered Disintegrates
const FB_DIRECT = 0.8         // rank 1: light upfront hit...
const FB_TICK = 0.4           // ...long dot: every 2s over 20s
const ES_COEFF = 3.3          // incl. S2 4pc +10%
const STARS_COEFF = 1.6       // Shattering Stars passive, incl. S2 2pc
const DEEP_BREATH_COEFF = 2.2
const UNBOUND_COEFF = 1.1
const DR_MULT = 1.1
const MELT_ARMOR_MULT = 1.1
const RISEN_FURY_MULT = 1.15  // at 5 Rising Fury stacks
const CAUSALITY_CDR = 0.6     // per Disintegrate tick, incl. S2 4pc +0.1
const EB_BASE_CHANCE = 0.15   // + crit chance, per Living Flame

function ebUp(s: SimAPI): number {
  return s.stacks('player', 'essence_burst')
}

function sweepReady(s: SimAPI): number {
  return s.stacks('player', 'azure_sweep')
}

export const devastationEvoker: SpecConfig = {
  name: 'Devastation Evoker',
  specId: 'evoker-devastation',
  specIcon: 'classicon_evoker_devastation',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/evoker/devastation/rotation-cooldowns-pve-dps',
    buildName: 'Scalecommander Raid/Delves (Icy Veins default raid build)',
    heroTalent: 'Scalecommander',
    // published verbatim on icy-veins.com/wow/devastation-evoker-pve-dps-spec-builds-talents
    talentString: 'CsbBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAjZgZYGzMgBjZamZmpZmx2MMzMzMzMzAmxMGzMLzMDMwYwGsMGN2GAzAwGGYmBDD',
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
      id: 'fire_breath_dot', name: 'Fire Breath', icon: 'ability_evoker_firebreath', duration: 20, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('fire_breath_dot', FB_TICK, { tags: ['fire'] }) },
    },
    {
      id: 'melt_armor', name: 'Melt Armor', icon: 'inv_ability_scalecommanderevoker_bombardments',
      duration: 12, debuff: true,
    },
    {
      id: 'imminent_destruction', name: 'Imminent Destruction', icon: 'ability_evoker_innatemagic4',
      duration: 12, maxStacks: 3,
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
        }
      },
    },
    {
      id: 'disintegrate',
      name: 'Disintegrate',
      icon: 'ability_evoker_disintegrate',
      spellId: 356995,
      cost: 3,
      costMod: (s) => (ebUp(s) > 0 ? 0 : s.stacks('player', 'imminent_destruction') > 0 ? 2 : 3),
      onCastStart: (s) => {
        if (s.stacks('player', 'imminent_destruction') > 0) s.consumeStack('player', 'imminent_destruction')
      },
      channel: {
        duration: 3,
        ticks: 4,
        hasted: true,
        onTick: (s, i) => {
          // an Essence Burst is consumed as the beam settles (first tick)
          if (i === 1 && ebUp(s) > 0) s.consumeStack('player', 'essence_burst')
          const idBoost = s.auraRemains('player', 'imminent_destruction') > 0 ? ID_DISINT_MULT : 1
          s.damage('disintegrate', DISINT_TICK * idBoost, { tags: ['arcane'] })
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
      castTime: 1.0, // rank 1 empower — released immediately
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
      id: 'deep_breath',
      name: 'Deep Breath',
      icon: 'ability_evoker_deepbreath',
      spellId: 357210,
      cooldown: 60,
      charges: 2, // APPROX: Strafing Run's recast window as a 2nd charge
      onResolve: (s) => {
        s.damage('deep_breath', DEEP_BREATH_COEFF, { tags: ['fire'] })
        s.applyAura('target', 'melt_armor')
        s.applyAura('player', 'imminent_destruction', { stacks: 3 })
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
    'eternity_surge', 'deep_breath', 'unbound_flame', 'dragonrage',
  ],

  hasteMod: (s) => 0.04 * s.stacks('player', 'rising_fury'),

  damageMult: (s) => {
    let m = 1
    if (s.auraRemains('player', 'dragonrage') > 0) m *= DR_MULT
    if (s.auraRemains('target', 'melt_armor') > 0) m *= MELT_ARMOR_MULT
    if (s.stacks('player', 'rising_fury') >= 5) m *= RISEN_FURY_MULT
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'disintegrate': return ebUp(s) > 0
      case 'azure_strike': return sweepReady(s) > 0
      case 'unbound_flame': return s.stacks('player', 'unbound_flame') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'deep_breath', text: 'On cooldown — Melt Armor + Imminent Destruction (recast after spending the charges)', when: s => s.chargesOf('deep_breath') > 0 && s.stacks('player', 'imminent_destruction') === 0 },
    { abilityId: 'dragonrage', text: 'On cooldown — stack Rising Fury to 5 while it runs', when: s => s.cooldownRemains('dragonrage') === 0 },
    { abilityId: 'fire_breath', text: 'Rank 1 on cooldown — keep the long dot rolling', when: s => s.cooldownRemains('fire_breath') === 0 },
    { abilityId: 'eternity_surge', text: 'Rank 1 on cooldown — fires a Shattering Star (2pc), loads Azure Sweep', when: s => s.cooldownRemains('eternity_surge') === 0 },
    { abilityId: 'disintegrate', text: 'Essence Burst or 3+ Essence — chain casts, never cap either', when: s => ebUp(s) > 0 || s.insanity >= 3 },
    { abilityId: 'unbound_flame', text: 'Spend the 4 post-Dragonrage charges when low on Essence with no Burst', when: s => s.stacks('player', 'unbound_flame') > 0 },
    { abilityId: 'azure_strike', label: 'Azure Sweep', icon: 'spell_arcane_arcanetorrent', text: 'Azure Sweep stacks from Eternity Surge — grants Essence Burst', when: s => sweepReady(s) > 0 },
    { abilityId: 'living_flame', text: 'Filler — fishes for Essence Burst (Azure Strike on the move)' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Disintegrate

    if (s.chargesOf('deep_breath') > 0 && s.stacks('player', 'imminent_destruction') === 0) return 'deep_breath'
    if (s.cooldownRemains('dragonrage') === 0) return 'dragonrage'
    if (s.cooldownRemains('fire_breath') === 0) return 'fire_breath'
    if (s.cooldownRemains('eternity_surge') === 0) return 'eternity_surge'
    if (ebUp(s) > 0 || s.insanity >= 3) return 'disintegrate'
    if (s.stacks('player', 'unbound_flame') > 0) return 'unbound_flame'
    if (sweepReady(s) > 0) return 'azure_strike'
    return 'living_flame'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const empowers = ['fire_breath', 'eternity_surge']
    const fillers = ['living_flame', 'disintegrate', 'azure_strike', 'unbound_flame']
    const burst = ['deep_breath', 'dragonrage']
    const sets = [empowers, fillers, burst]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
