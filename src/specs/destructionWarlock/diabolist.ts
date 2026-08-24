import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Destruction Warlock — patch 12.1.0 (Midnight, Season 2), Diabolist raid
 * single-target build (alternate to the default Hellcaller build).
 * Verified against live guides 2026-08-24:
 *  - Wowhead rotation guide: https://www.wowhead.com/guide/classes/warlock/destruction/rotation-cooldowns-pve-dps
 *  - Method (Diabolist ST priority): https://www.method.gg/guides/destruction-warlock/playstyle-and-rotation
 *  - Icy Veins: https://www.icy-veins.com/wow/destruction-warlock-pve-dps-rotation-cooldowns-abilities
 *  - Kalamazi (talent string): https://www.kalamazi.gg/guides/destruction
 *
 * Diabolist: Immolate stays plain (no Wither, no Malevolence). Spending
 * Soul Shards advances the Diabolic Ritual; each completed ritual arms a
 * Demonic Art that your next Chaos Bolt consumes, cycling Overlord smash
 * → Mother of Chaos (your next Incinerate becomes Infernal Bolt, +3
 * shards) → Pit Lord (big hit + Ruination transforms the next Chaos
 * Bolt into a free green meteor). Method's ST priority: Chaos Bolt to
 * consume Demonic Arts and restart the ritual → maintain Immolate →
 * Summon Infernal → Shadowburn with Fiendish Cruelty → Chaos Bolt to
 * never cap → Soul Fire (with Backdraft) → Conflagrate to avoid sitting
 * on 2 charges → Incinerate. Chaos Bolt/Ruination/Shadowburn always
 * crit. S2 tier ("Echo of Sargeras"): 2pc Incinerate +25% and doubled
 * Echo chance (folded: 20% proc); 4pc Echo'd targets take +6% for 6s.
 * APPROX: ritual threshold (6 shards spent per Demonic Art),
 * Overlord/Pit Lord/Ruination/Infernal Bolt coefficients, ember/shard
 * cadence, Fiendish Cruelty proc rate, Rain of Chaos kept from the
 * Infernal window kit.
 */

const IMMO_TICK = 0.42
const INC_COEFF = 1.05            // incl. S2 2pc +25%
const CONFLAG_COEFF = 0.6
const CB_COEFF = 2.4              // always crits
const SHADOWBURN_COEFF = 0.95     // always crits
const FIENDISH_MULT = 1.5         // Fiendish Cruelty-empowered Shadowburn
const SOUL_FIRE_COEFF = 1.6
const INFERNAL_IMPACT = 2.0
const INFERNAL_PULSE = 0.25       // 20 pulses over 20s, each +0.1 shard
const RAIN_OF_CHAOS_COEFF = 0.9   // lesser infernal blast during the window
const ECHO_COEFF = 0.6            // Echo of Sargeras proc hit
const ECHO_CHANCE = 0.20          // incl. S2 2pc doubling
const EMBERS_AMP = 1.06           // S2 4pc: Embers of Nihilam debuff
const BACKDRAFT_CAST_MULT = 0.7
const OVERLORD_COEFF = 1.9
const PIT_LORD_COEFF = 2.2
const RUINATION_COEFF = 3.2       // empowered Chaos Bolt; always crits
const INFERNAL_BOLT_COEFF = 1.4   // Incinerate replacement, +3 shards
const DEMONIC_ART_COST = 6        // APPROX: shards spent per completed ritual

function consumeBackdraft(s: SimAPI) {
  if (s.stacks('player', 'backdraft') > 0) s.consumeStack('player', 'backdraft')
}

/** Diabolist: spending shards advances the ritual toward the next Art */
function trackDiabolic(s: SimAPI, spent: number) {
  s.data.diabolic = (s.data.diabolic ?? 0) + spent
  if (s.data.diabolic >= DEMONIC_ART_COST) {
    s.data.diabolic -= DEMONIC_ART_COST
    s.applyAura('player', 'demonic_art')
  }
}

/** is the Chaos Bolt button currently in its Ruination form? */
function ruinationReady(s: SimAPI): boolean {
  return s.auraRemains('player', 'ruination') > 0
}

/** is the Incinerate button currently in its Infernal Bolt form? */
function infernalBoltReady(s: SimAPI): boolean {
  return s.auraRemains('player', 'infernal_bolt') > 0
}

export const destructionDiabolist: SpecConfig = {
  name: 'Destruction Warlock',
  specId: 'warlock-destruction',
  specIcon: 'spell_shadow_rainoffire',
  buildId: 'diabolist',
  resourceName: 'Soul Shards',
  resourceMax: 5,
  startingResource: 3,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/warlock/destruction/rotation-cooldowns-pve-dps',
    buildName: 'Diabolist Raid Single Target',
    heroTalent: 'Diabolist',
    // published verbatim by kalamazi.gg ("Diabolist Single Target")
    talentString: 'EAORKURBVUVFUVGYUBQOVFUWIUUFZRVFDQCBEFFVVVUBF',
    retrieved: '2026-08-24',
  },

  auras: [
    {
      id: 'immolate', name: 'Immolate', icon: 'spell_fire_immolation',
      duration: 18, pandemic: true, debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          s.damage('immolate', IMMO_TICK)
          // crit ticks flake off ember shards
          if (s.rng('immolate_shard') < s.stats.critChance) s.gain(0.1, 'immolate')
          // Fiendish Cruelty: Immolate ticks prime Shadowburn (APPROX rate)
          if (s.rng('fiendish_cruelty') < 0.08) s.applyAura('player', 'fiendish_cruelty')
        },
      },
    },
    { id: 'backdraft', name: 'Backdraft', icon: 'ability_warlock_backdraft', duration: 10, maxStacks: 2 },
    { id: 'fiendish_cruelty', name: 'Fiendish Cruelty', icon: 'spell_shadow_scourgebuild', duration: 12 },
    { id: 'embers_of_nihilam', name: 'Embers of Nihilam', icon: 'spell_fire_felflamering', duration: 6, debuff: true },
    { id: 'demonic_art', name: 'Demonic Art', icon: 'ability_warlock_demonicpower', duration: 30 },
    { id: 'ruination', name: 'Ruination', icon: 'spell_fire_felflamering', duration: 30 },
    { id: 'infernal_bolt', name: 'Infernal Bolt', icon: 'spell_fel_firebolt', duration: 30 },
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
        s.applyAura('target', 'immolate')
      },
    },
    {
      // One button, as in game: Mother of Chaos transforms it into
      // Infernal Bolt (+3 shards) for one cast.
      id: 'incinerate',
      name: 'Incinerate',
      icon: 'spell_fire_burnout',
      spellId: 29722,
      castTime: 2.0,
      displayName: (s) => (infernalBoltReady(s) ? 'Infernal Bolt' : 'Incinerate'),
      displayIcon: (s) => (infernalBoltReady(s) ? 'spell_fel_firebolt' : 'spell_fire_burnout'),
      castTimeMod: (s, base) => base * (s.stacks('player', 'backdraft') > 0 ? BACKDRAFT_CAST_MULT : 1),
      onCastStart: (s) => {
        s.data.inc_infernal = infernalBoltReady(s) ? 1 : 0
      },
      onResolve: (s) => {
        consumeBackdraft(s)
        if (s.data.inc_infernal) {
          s.data.inc_infernal = 0
          s.removeAura('player', 'infernal_bolt')
          s.damage('infernal_bolt', INFERNAL_BOLT_COEFF)
          s.gain(3, 'infernal_bolt') // Mother of Chaos hands the shards back
        } else {
          s.gain(0.3, 'incinerate') // incl. ember talents (APPROX)
          s.damage('incinerate', INC_COEFF)
        }
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
      },
    },
    {
      // One button, as in game: the Pit Lord's Ruination transforms it.
      id: 'chaos_bolt',
      name: 'Chaos Bolt',
      icon: 'ability_warlock_chaosbolt',
      spellId: 116858,
      castTime: 2.5,
      cost: 2,
      costMod: (s) => (ruinationReady(s) ? 0 : 2),
      displayName: (s) => (ruinationReady(s) ? 'Ruination' : 'Chaos Bolt'),
      displayIcon: (s) => (ruinationReady(s) ? 'spell_fire_felflamering' : 'ability_warlock_chaosbolt'),
      castTimeMod: (s, base) => base * (s.stacks('player', 'backdraft') > 0 ? BACKDRAFT_CAST_MULT : 1),
      onCastStart: (s) => {
        s.data.cb_ruin = ruinationReady(s) ? 1 : 0
      },
      onResolve: (s) => {
        consumeBackdraft(s)
        if (s.data.cb_ruin) {
          s.data.cb_ruin = 0
          s.removeAura('player', 'ruination')
          s.damage('Ruination', RUINATION_COEFF * s.stats.critMult, { canCrit: false }) // always crits
          return
        }
        s.damage('chaos_bolt', CB_COEFF * s.stats.critMult, { canCrit: false }) // always crits
        trackDiabolic(s, 2)
        // an armed Demonic Art resolves on the next paid Chaos Bolt
        if (s.auraRemains('player', 'demonic_art') > 0) {
          s.removeAura('player', 'demonic_art')
          const cycle = (s.data.art_cycle ?? 0) % 3
          s.data.art_cycle = cycle + 1
          if (cycle === 0) {
            s.schedule(s.time + 0.6, () => s.damage('Overlord', OVERLORD_COEFF))
          } else if (cycle === 1) {
            s.applyAura('player', 'infernal_bolt') // Mother of Chaos
          } else {
            s.schedule(s.time + 0.6, () => s.damage('Pit Lord', PIT_LORD_COEFF))
            s.applyAura('player', 'ruination')
          }
        }
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
        trackDiabolic(s, 1)
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
        s.applyAura('target', 'immolate') // refreshes Immolate
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
    'shadowburn', 'soul_fire', 'summon_infernal',
  ],

  // S2 4pc: targets marked by Echo of Sargeras take +6%
  damageMult: (s) => (s.auraRemains('target', 'embers_of_nihilam') > 0 ? EMBERS_AMP : 1),

  glows: (s, id) => {
    switch (id) {
      case 'chaos_bolt': return ruinationReady(s)
        || (s.insanity >= 2 && s.auraRemains('player', 'demonic_art') > 0)
        || s.insanity >= 4
      case 'incinerate': return infernalBoltReady(s) || s.stacks('player', 'backdraft') > 0
      case 'shadowburn': return s.auraRemains('player', 'fiendish_cruelty') > 0 && s.insanity >= 1
      case 'conflagrate': return s.chargesOf('conflagrate') === 2
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'chaos_bolt', label: 'Ruination', icon: 'spell_fire_felflamering', text: 'Free after the Pit Lord — press it', when: s => ruinationReady(s) },
    { abilityId: 'chaos_bolt', text: 'Consume Demonic Arts — it restarts the Diabolic Ritual', when: s => !ruinationReady(s) && s.auraRemains('player', 'demonic_art') > 0 && s.insanity >= 2 },
    { abilityId: 'immolate', text: 'Keep it rolling — refresh in pandemic (<5.4s), never drop it' },
    { abilityId: 'summon_infernal', text: 'On cooldown — spend hard inside it (Rain of Chaos)', when: s => s.cooldownRemains('summon_infernal') === 0 },
    { abilityId: 'shadowburn', text: 'On Fiendish Cruelty procs, or at 2 charges — it advances the ritual', when: s => s.insanity >= 1 && s.chargesOf('shadowburn') > 0 && (s.auraRemains('player', 'fiendish_cruelty') > 0 || s.chargesOf('shadowburn') === 2) },
    { abilityId: 'chaos_bolt', text: 'At 4+ shards, with Backdraft, or inside Infernal — never cap', when: s => s.insanity >= 4 },
    { abilityId: 'soul_fire', text: 'On cooldown below 4 shards, preferably with Backdraft', when: s => s.cooldownRemains('soul_fire') === 0 && s.insanity < 4 },
    { abilityId: 'conflagrate', text: 'Keep charges rolling — feeds Backdraft', when: s => s.chargesOf('conflagrate') === 2 },
    { abilityId: 'incinerate', label: 'Infernal Bolt', icon: 'spell_fel_firebolt', text: 'Mother of Chaos hands it to you — +3 shards, cast it low', when: s => infernalBoltReady(s) && s.insanity <= 2 },
    { abilityId: 'incinerate', text: 'Filler — always be casting' },
  ],

  /** Oracle — Method 12.1 Diabolist ST priority. */
  policy: (s) => {
    const imm = s.auraRemains('target', 'immolate')
    const shards = s.insanity
    const backdraft = s.stacks('player', 'backdraft')
    const windowUp = s.auraRemains('player', 'infernal') > 0

    // Ruination is free and huge — never sit on it
    if (ruinationReady(s)) return 'chaos_bolt'

    // Chaos Bolt to consume an armed Demonic Art and restart the ritual
    if (s.auraRemains('player', 'demonic_art') > 0 && shards >= 2) return 'chaos_bolt'

    if (imm <= 0 || imm < 18 * 0.3) return 'immolate'
    if (s.cooldownRemains('summon_infernal') === 0) return 'summon_infernal'

    // shadowburn: Fiendish Cruelty procs, or don't sit on 2 charges
    if (shards >= 1 && s.chargesOf('shadowburn') > 0
      && (s.auraRemains('player', 'fiendish_cruelty') > 0 || s.chargesOf('shadowburn') === 2)) {
      return 'shadowburn'
    }

    // chaos_bolt: never cap; spend hard inside Infernal / with Backdraft
    if (shards >= 2 && (shards >= 4 || windowUp || backdraft > 0)) return 'chaos_bolt'

    // soul_fire: on cooldown while below 4 shards
    if (s.cooldownRemains('soul_fire') === 0 && shards < 4) return 'soul_fire'

    if (s.chargesOf('conflagrate') === 2 || (backdraft === 0 && s.chargesOf('conflagrate') > 0)) return 'conflagrate'

    // Infernal Bolt (transformed Incinerate) and plain Incinerate share
    // the button — cast it; the +3 shard form resolves itself
    return 'incinerate'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['incinerate', 'conflagrate', 'soul_fire']
    const spenders = ['chaos_bolt', 'shadowburn']
    const sets = [fillers, spenders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
