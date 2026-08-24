import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Demonology Warlock — patch 12.1.0 (Midnight, Season 2), Diabolist raid
 * ST build (Icy Veins default). Built from the simc `midnight` APL/source
 * and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Soul Shards (max 5). Pets are scheduled damage streams:
 * Felguard swing loop, Wild Imp firebolt volleys (5 bolts over ~8s each),
 * Dreadstalker bite trains that hand back 2 Demonic Cores on despawn,
 * a Vilefiend pulse train, and Demonic Tyrant as a 15s +15% damage window
 * with its own beam. Diabolist: every 10 shards spent charges a Demonic
 * Art — the next Hand of Gul'dan also summons an Overlord smash.
 * Talent assumptions: Demonic Core Demonbolts only, Doom not taken,
 * Apex: Diabolic Momentum 3/3 (each Demonic Core spent shaves 2s off
 * Demonic Tyrant). S2 tier: 2pc Wild Imp bolts +25% (folded into the
 * coefficient); 4pc Dreadstalkers bite 25% harder (folded).
 * APPROX-flagged: pet cadences, Demonic Art threshold, Tyrant window as a
 * flat multiplier instead of per-demon extension. Damage in SP units.
 */

const FELGUARD_SWING = 0.28   // every 2s, hasted
const SB_COEFF = 0.75
const DB_COEFF = 1.05
const HOG_IMPACT = 0.35       // per shard spent
const IMP_BOLT = 0.115        // incl. S2 2pc +25%; 5 bolts per imp
const STALKER_BITE = 0.24     // incl. S2 4pc; 6 bites over 12s
const VILEFIEND_PULSE = 0.32  // 8 pulses over 14s
const TYRANT_HIT = 0.9
const TYRANT_PULSE = 0.38     // 14 beams over 14s
const TYRANT_MULT = 1.15
const OVERLORD_COEFF = 1.9
const DEMONIC_ART_COST = 10   // APPROX: shards spent per Art

/** Diabolist: spending shards charges the next Demonic Art */
function trackDiabolic(s: SimAPI, spent: number) {
  s.data.diabolic = (s.data.diabolic ?? 0) + spent
  if (s.data.diabolic >= DEMONIC_ART_COST) {
    s.data.diabolic -= DEMONIC_ART_COST
    s.applyAura('player', 'demonic_art')
  }
}

function spawnImps(s: SimAPI, n: number) {
  for (let i = 0; i < n; i++) {
    for (let bolt = 0; bolt < 5; bolt++) {
      s.schedule(s.time + 0.8 + bolt * 1.6, () => s.damage('Wild Imp', IMP_BOLT))
    }
  }
}

export const demonologyWarlock: SpecConfig = {
  name: 'Demonology Warlock',
  specId: 'warlock-demonology',
  specIcon: 'spell_shadow_metamorphosis',
  resourceName: 'Soul Shards',
  resourceMax: 5,
  startingResource: 3,

  onCombatStart: (s) => {
    // Felguard auto-attack loop
    const swing = () => {
      s.damage('Felguard', FELGUARD_SWING)
      s.schedule(s.time + 2.0 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.5, swing)
  },

  auras: [
    { id: 'demonic_core', name: 'Demonic Core', icon: 'warlock_spelldrain', duration: 20, maxStacks: 4 },
    { id: 'demonic_art', name: 'Demonic Art', icon: 'inv_ability_diabolistwarlock_demonicart', duration: 30 },
    { id: 'demonic_tyrant', name: 'Demonic Tyrant', icon: 'inv_summondemonictyrant', duration: 15 },
  ],

  abilities: [
    {
      id: 'shadow_bolt',
      name: 'Shadow Bolt',
      icon: 'spell_shadow_shadowbolt',
      spellId: 686,
      castTime: 2.0,
      onResolve: (s) => {
        s.gain(1, 'shadow_bolt')
        s.damage('shadow_bolt', SB_COEFF)
      },
    },
    {
      id: 'demonbolt',
      name: 'Demonbolt',
      icon: 'inv__demonbolt',
      spellId: 264178,
      castTime: 4.5,
      castTimeMod: (s, base) => (s.stacks('player', 'demonic_core') > 0 ? 0 : base),
      onCastStart: (s) => {
        s.data.db_core = s.stacks('player', 'demonic_core') > 0 ? 1 : 0
      },
      onResolve: (s) => {
        if (s.data.db_core) {
          s.consumeStack('player', 'demonic_core')
          s.data.db_core = 0
          // Apex: Diabolic Momentum — each Core spent shaves 2s off Tyrant
          s.reduceCooldown('summon_demonic_tyrant', 2)
        }
        s.gain(2, 'demonbolt')
        s.damage('demonbolt', DB_COEFF)
      },
    },
    {
      id: 'hand_of_guldan',
      name: "Hand of Gul'dan",
      icon: 'ability_warlock_handofguldan',
      spellId: 105174,
      castTime: 1.5,
      cost: 1,
      costMod: (s) => Math.min(3, Math.max(1, Math.floor(s.insanity))),
      // shards paid are read at cast start (cost is deducted before onResolve)
      onCastStart: (s) => {
        s.data.hog_paid = Math.min(3, Math.max(1, Math.floor(s.insanity)))
      },
      onResolve: (s) => {
        const paid = s.data.hog_paid ?? 1
        s.damage('hand_of_guldan', HOG_IMPACT * paid)
        spawnImps(s, paid)
        trackDiabolic(s, paid)
        if (s.auraRemains('player', 'demonic_art') > 0) {
          s.removeAura('player', 'demonic_art')
          s.schedule(s.time + 0.6, () => s.damage('Overlord', OVERLORD_COEFF))
        }
      },
    },
    {
      id: 'call_dreadstalkers',
      name: 'Call Dreadstalkers',
      icon: 'spell_warlock_calldreadstalkers',
      spellId: 104316,
      cost: 2,
      cooldown: 20,
      onResolve: (s) => {
        trackDiabolic(s, 2)
        for (let i = 0; i < 6; i++) {
          s.schedule(s.time + 0.5 + i * 2, () => s.damage('Dreadstalker', STALKER_BITE * 2)) // 2 stalkers
        }
        // despawn hands back 2 Demonic Cores
        s.schedule(s.time + 12.5, () => s.applyAura('player', 'demonic_core', { stacks: 2 }))
      },
    },
    {
      id: 'summon_vilefiend',
      name: 'Summon Vilefiend',
      icon: 'inv_argusfelstalkermount',
      spellId: 264119,
      cooldown: 45,
      onResolve: (s) => {
        for (let i = 0; i < 8; i++) {
          s.schedule(s.time + 1 + i * 1.75, () => s.damage('Vilefiend', VILEFIEND_PULSE))
        }
      },
    },
    {
      id: 'summon_demonic_tyrant',
      name: 'Summon Demonic Tyrant',
      icon: 'inv_summondemonictyrant',
      spellId: 265187,
      castTime: 2.0,
      cooldown: 90,
      onResolve: (s) => {
        s.applyAura('player', 'demonic_tyrant')
        s.damage('Demonic Tyrant', TYRANT_HIT)
        for (let i = 0; i < 14; i++) {
          s.schedule(s.time + 1 + i, () => s.damage('Demonic Tyrant', TYRANT_PULSE))
        }
      },
    },
  ],

  actionBar: [
    'shadow_bolt', 'demonbolt', 'hand_of_guldan', 'call_dreadstalkers',
    'summon_vilefiend', 'summon_demonic_tyrant',
  ],

  damageMult: (s) => (s.auraRemains('player', 'demonic_tyrant') > 0 ? TYRANT_MULT : 1),

  glows: (s, id) => {
    switch (id) {
      case 'demonbolt': return s.stacks('player', 'demonic_core') > 0
      case 'hand_of_guldan': return s.auraRemains('player', 'demonic_art') > 0 || s.insanity >= 3
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'call_dreadstalkers', text: 'On cooldown (2 shards) — they hand back Demonic Cores', when: s => s.cooldownRemains('call_dreadstalkers') === 0 && s.insanity >= 2 },
    { abilityId: 'summon_vilefiend', text: 'On cooldown', when: s => s.cooldownRemains('summon_vilefiend') === 0 },
    { abilityId: 'hand_of_guldan', text: 'At 3 shards (Demonic Art: adds an Overlord smash)', when: s => s.insanity >= 3 },
    { abilityId: 'summon_demonic_tyrant', text: 'After dumping shards and stalkers — 15s empower window', when: s => s.cooldownRemains('summon_demonic_tyrant') === 0 },
    { abilityId: 'demonbolt', text: 'Spend Demonic Cores (instant, 2 shards; Apex shaves Tyrant)', when: s => s.stacks('player', 'demonic_core') > 0 },
    { abilityId: 'shadow_bolt', text: 'Filler — always be casting' },
  ],

  policy: (s) => {
    const shards = Math.floor(s.insanity)
    const cores = s.stacks('player', 'demonic_core')
    const tyrantCd = s.cooldownRemains('summon_demonic_tyrant')

    if (tyrantCd === 0) {
      // dump the kennel, then call the big guy
      if (s.cooldownRemains('call_dreadstalkers') === 0 && shards >= 2) return 'call_dreadstalkers'
      if (shards >= 3) return 'hand_of_guldan'
      return 'summon_demonic_tyrant'
    }
    if (s.cooldownRemains('call_dreadstalkers') === 0 && shards >= 2) return 'call_dreadstalkers'
    if (s.cooldownRemains('summon_vilefiend') === 0) return 'summon_vilefiend'
    if (shards >= 3) return 'hand_of_guldan'
    if (cores > 0 && shards <= 3) return 'demonbolt'
    return 'shadow_bolt'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['shadow_bolt', 'demonbolt']
    const summons = ['call_dreadstalkers', 'summon_vilefiend']
    const sets = [builders, summons]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
