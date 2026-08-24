import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Destruction Warlock — patch 12.1.0 (Midnight, Season 2), Hellcaller raid
 * single-target build. Verified against live guides 2026-08-24:
 *  - Wowhead rotation guide: https://www.wowhead.com/guide/classes/warlock/destruction/rotation-cooldowns-pve-dps
 *  - Icy Veins: https://www.icy-veins.com/wow/destruction-warlock-pve-dps-rotation-cooldowns-abilities
 *  - Method: https://www.method.gg/guides/destruction-warlock/playstyle-and-rotation
 *  - Kalamazi: https://www.kalamazi.gg/guides/destruction (Hellcaller wins raid ST)
 *
 * Hellcaller: Immolate runs as Wither — direct casts stack it to 8 and the
 * tick ramps with stacks. Malevolence (1 min) surges the ramp, grants haste
 * for 20s, and every shard spender inside it adds an extra Wither stack.
 * ST priority: keep Wither rolling → Summon Infernal (90s with Inferno) →
 * Malevolence → Shadowburn on Fiendish Cruelty procs / at 2 charges →
 * Soul Fire below 4 shards → Chaos Bolt to never cap (spend hard inside
 * Infernal/Malevolence) → Conflagrate to keep charges rolling → Incinerate.
 * Chaos Bolt always crits. S2 tier ("Echo of Sargeras"): 2pc Incinerate
 * +25% and doubled Echo of Sargeras chance (folded: 20% proc on
 * Incinerate); 4pc Echo'd targets take +6% damage for 6s via Embers of
 * Nihilam (modeled as a debuff). APPROX: Wither ramp numbers, ember/shard
 * cadence, Fiendish Cruelty proc rate, Echo of Sargeras coefficient,
 * Rain of Chaos kept from the Infernal window kit.
 */

const IMMO_TICK_BASE = 0.15
const IMMO_TICK_PER_STACK = 0.05 // Wither ramp, max 8 stacks
const WITHER_MAX = 8
const INC_COEFF = 1.05            // incl. S2 2pc +25%
const CONFLAG_COEFF = 0.6
const CB_COEFF = 2.4              // always crits
const SHADOWBURN_COEFF = 0.95     // always crits
const FIENDISH_MULT = 1.5         // Fiendish Cruelty-empowered Shadowburn
const SOUL_FIRE_COEFF = 1.6
const MALEV_HIT = 1.5
const MALEV_HASTE = 0.10
const INFERNAL_IMPACT = 2.0
const INFERNAL_PULSE = 0.25       // 20 pulses over 20s, each +0.1 shard
const RAIN_OF_CHAOS_COEFF = 0.9   // lesser infernal blast during the window
const ECHO_COEFF = 0.6            // Echo of Sargeras proc hit
const ECHO_CHANCE = 0.20          // incl. S2 2pc doubling
const EMBERS_AMP = 1.06           // S2 4pc: Embers of Nihilam debuff
const BACKDRAFT_CAST_MULT = 0.7

/** Hellcaller: direct casts stack Wither on the Immolate debuff */
function addWitherStack(s: SimAPI, n = 1) {
  const a = s.aura('target', 'immolate')
  if (a) a.stacks = Math.min(WITHER_MAX, a.stacks + n)
}

/** Malevolence: shard spenders inside the window ramp Wither harder */
function spenderWither(s: SimAPI) {
  addWitherStack(s, s.auraRemains('player', 'malevolence') > 0 ? 2 : 1)
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

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/warlock/destruction/rotation-cooldowns-pve-dps',
    buildName: 'Hellcaller Raid Single Target',
    heroTalent: 'Hellcaller',
    retrieved: '2026-08-24',
  },

  auras: [
    {
      id: 'immolate', name: 'Wither', icon: 'spell_fire_immolation',
      duration: 18, pandemic: true, debuff: true, maxStacks: WITHER_MAX,
      tick: {
        interval: 2, hasted: true,
        onTick: (s, aura) => {
          s.damage('immolate', IMMO_TICK_BASE + IMMO_TICK_PER_STACK * aura.stacks)
          // crit ticks flake off ember shards
          if (s.rng('immolate_shard') < s.stats.critChance) s.gain(0.1, 'immolate')
          // Fiendish Cruelty: Wither ticks prime Shadowburn (APPROX rate)
          if (s.rng('fiendish_cruelty') < 0.08) s.applyAura('player', 'fiendish_cruelty')
        },
      },
    },
    { id: 'backdraft', name: 'Backdraft', icon: 'ability_warlock_backdraft', duration: 10, maxStacks: 2 },
    { id: 'fiendish_cruelty', name: 'Fiendish Cruelty', icon: 'spell_shadow_scourgebuild', duration: 12 },
    { id: 'embers_of_nihilam', name: 'Embers of Nihilam', icon: 'spell_fire_felflamering', duration: 6, debuff: true },
    { id: 'malevolence', name: 'Malevolence', icon: 'inv_ability_hellcallerwarlock_malevolence', duration: 20 },
    { id: 'infernal', name: 'Summon Infernal', icon: 'spell_shadow_summoninfernal', duration: 20 },
  ],

  abilities: [
    {
      id: 'immolate',
      name: 'Wither',
      icon: 'spell_fire_immolation',
      spellId: 445468,
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
        s.gain(0.3, 'incinerate') // incl. ember talents (APPROX)
        s.damage('incinerate', INC_COEFF)
        addWitherStack(s)
        // S2 2pc/4pc: Echo of Sargeras proc + Embers of Nihilam damage amp
        if (s.rng('echo_of_sargeras') < ECHO_CHANCE) {
          s.damage('Echo of Sargeras', ECHO_COEFF)
          s.applyAura('target', 'embers_of_nihilam')
        }
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
        spenderWither(s)
        // Rain of Chaos: hard spending inside the Infernal window pays out
        if (s.auraRemains('player', 'infernal') > 0 && s.rng('rain_of_chaos') < 0.40) {
          s.schedule(s.time + 0.5, () => s.damage('Rain of Chaos', RAIN_OF_CHAOS_COEFF))
        }
      },
    },
    {
      id: 'shadowburn',
      name: 'Shadowburn',
      icon: 'spell_shadow_scourgebuild',
      spellId: 17877,
      cooldown: 12,
      charges: 2,
      cost: 1,
      onResolve: (s) => {
        let mult = 1
        if (s.auraRemains('player', 'fiendish_cruelty') > 0) {
          s.removeAura('player', 'fiendish_cruelty')
          mult = FIENDISH_MULT
        }
        s.damage('shadowburn', SHADOWBURN_COEFF * mult * s.stats.critMult, { canCrit: false }) // always crits
        spenderWither(s)
      },
    },
    {
      id: 'soul_fire',
      name: 'Soul Fire',
      icon: 'spell_fire_fireball02',
      spellId: 6353,
      castTime: 2.5,
      cooldown: 45,
      castTimeMod: (s, base) => base * (s.stacks('player', 'backdraft') > 0 ? BACKDRAFT_CAST_MULT : 1),
      onResolve: (s) => {
        consumeBackdraft(s)
        s.gain(1, 'soul_fire')
        s.damage('soul_fire', SOUL_FIRE_COEFF)
        s.applyAura('target', 'immolate') // refreshes Wither
        addWitherStack(s)
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
        addWitherStack(s, 4) // surges the Wither ramp
      },
    },
    {
      id: 'summon_infernal',
      name: 'Summon Infernal',
      icon: 'spell_shadow_summoninfernal',
      spellId: 1122,
      cooldown: 90, // with Inferno
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
    'shadowburn', 'soul_fire', 'malevolence', 'summon_infernal',
  ],

  // S2 4pc: targets marked by Echo of Sargeras take +6%
  damageMult: (s) => (s.auraRemains('target', 'embers_of_nihilam') > 0 ? EMBERS_AMP : 1),
  hasteMod: (s) => (s.auraRemains('player', 'malevolence') > 0 ? MALEV_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'chaos_bolt': return s.insanity >= 4 || (s.insanity >= 2 && (s.auraRemains('player', 'infernal') > 0 || s.auraRemains('player', 'malevolence') > 0))
      case 'shadowburn': return s.auraRemains('player', 'fiendish_cruelty') > 0 && s.insanity >= 1
      case 'conflagrate': return s.chargesOf('conflagrate') === 2
      case 'incinerate': return s.stacks('player', 'backdraft') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'immolate', text: 'Keep Wither rolling — refresh in pandemic (<5.4s), never drop it' },
    { abilityId: 'summon_infernal', text: 'On cooldown — spend hard inside it (Rain of Chaos)', when: s => s.cooldownRemains('summon_infernal') === 0 },
    { abilityId: 'malevolence', text: 'On cooldown — surges Wither +4 and hastes the window', when: s => s.cooldownRemains('malevolence') === 0 },
    { abilityId: 'shadowburn', text: 'On Fiendish Cruelty procs, or at 2 charges', when: s => s.insanity >= 1 && s.chargesOf('shadowburn') > 0 && (s.auraRemains('player', 'fiendish_cruelty') > 0 || s.chargesOf('shadowburn') === 2) },
    { abilityId: 'soul_fire', text: 'On cooldown below 4 shards', when: s => s.cooldownRemains('soul_fire') === 0 && s.insanity < 4 },
    { abilityId: 'chaos_bolt', text: 'At 4+ shards, with Backdraft, or inside Infernal/Malevolence — never cap', when: s => s.insanity >= 4 },
    { abilityId: 'conflagrate', text: 'Keep charges rolling — feeds Backdraft', when: s => s.chargesOf('conflagrate') === 2 },
    { abilityId: 'incinerate', text: 'Filler — always be casting' },
  ],

  /** Oracle — Wowhead/Method/Icy Veins 12.1 Hellcaller ST priority. */
  policy: (s) => {
    const imm = s.auraRemains('target', 'immolate')
    const shards = s.insanity
    const backdraft = s.stacks('player', 'backdraft')
    const windowUp = s.auraRemains('player', 'infernal') > 0 || s.auraRemains('player', 'malevolence') > 0

    if (imm <= 0 || imm < 18 * 0.3) return 'immolate'
    if (s.cooldownRemains('summon_infernal') === 0) return 'summon_infernal'
    if (s.cooldownRemains('malevolence') === 0) return 'malevolence'

    // shadowburn: Fiendish Cruelty procs, or don't sit on 2 charges
    if (shards >= 1 && s.chargesOf('shadowburn') > 0
      && (s.auraRemains('player', 'fiendish_cruelty') > 0 || s.chargesOf('shadowburn') === 2)) {
      return 'shadowburn'
    }

    // soul_fire: on cooldown while below 4 shards
    if (s.cooldownRemains('soul_fire') === 0 && shards < 4) return 'soul_fire'

    // chaos_bolt: never cap; spend hard inside Infernal/Malevolence
    if (shards >= 2 && (shards >= 4 || windowUp || backdraft > 0)) return 'chaos_bolt'

    if (s.chargesOf('conflagrate') === 2 || (backdraft === 0 && s.chargesOf('conflagrate') > 0)) return 'conflagrate'
    return 'incinerate'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['incinerate', 'conflagrate', 'soul_fire']
    const spenders = ['chaos_bolt', 'shadowburn']
    const burst = ['malevolence', 'summon_infernal']
    const sets = [fillers, spenders, burst]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
