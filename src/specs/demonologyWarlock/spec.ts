import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Demonology Warlock — patch 12.1.0 (Midnight, Season 2), Diabolist raid
 * single-target build. Verified against live guides 2026-08-24:
 *  - Wowhead rotation guide: https://www.wowhead.com/guide/classes/warlock/demonology/rotation-cooldowns-pve-dps
 *  - Icy Veins: https://www.icy-veins.com/wow/demonology-warlock-pve-dps-rotation-cooldowns-abilities
 *  - Method: https://www.method.gg/guides/demonology-warlock/playstyle-and-rotation
 *  - Maxroll raid guide: https://maxroll.gg/wow/class-guides/demonology-warlock-raid-guide
 *  - Kalamazi (talent string): https://www.kalamazi.gg/guides/demonology
 *
 * 12.1 kit: Call Dreadstalkers + Grimoire: Imp Lord feed a 15s Summon
 * Demonic Tyrant window where you chain Hand of Gul'dan (Dominion of Argus
 * refunds 1 shard per HoG inside the window). Summon Doomguard is a 2min
 * pet that ignores Tyrant. Diabolist rituals: spending shards charges a
 * Demonic Art — consumed by the next paid HoG, cycling Overlord smash →
 * Mother of Chaos (grants Infernal Bolt, +3 shards) → Pit Lord (big hit +
 * Ruination transforms the next HoG). Wild Imps are tracked individually:
 * Power Siphon eats 2 for Demonic Cores, Implosion detonates 6+.
 * S2 tier: 2pc Wild Imps +10% / Implosion +20% (folded into coefficients);
 * 4pc expiring imps have a 20% chance to self-Implode (modeled).
 * APPROX: pet cadences and coefficients, ritual threshold (8 shards/Art),
 * Imp Lord & Tyrant cooldowns, Tyrant window as flat +15% (excl. Doomguard).
 */

const FELGUARD_SWING = 0.28   // every 2s, hasted
const SB_COEFF = 0.75
const DB_COEFF = 1.05
const HOG_IMPACT = 0.35       // per shard spent
const IMP_BOLT = 0.11         // incl. S2 2pc +10%; 5 bolts per imp
const IMP_LIFESPAN = 8
const STALKER_BITE = 0.24     // 6 bites over 12s, per stalker
const IMP_LORD_HIT = 0.5      // 10 smashes over 20s
const DOOM_BOLT = 0.85        // 8 bolts over 20s, unaffected by Tyrant
const TYRANT_HIT = 0.9
const TYRANT_PULSE = 0.38     // 15 beams over 15s
const TYRANT_MULT = 1.15
const IMPLOSION_PER_IMP = 0.38 // incl. S2 2pc +20%
const OVERLORD_COEFF = 1.9
const PIT_LORD_COEFF = 2.2
const RUINATION_COEFF = 2.5
const INFERNAL_BOLT_COEFF = 1.0
const DEMONIC_ART_COST = 8    // APPROX: shards spent per completed ritual

/** Wild Imps tracked per-sim so Power Siphon / Implosion can consume them. */
interface ImpToken { alive: boolean }
const impBank = new WeakMap<Record<string, number>, ImpToken[]>()

function impList(s: SimAPI): ImpToken[] {
  let list = impBank.get(s.data)
  if (!list) {
    list = []
    impBank.set(s.data, list)
  }
  return list
}

function impCount(s: SimAPI): number {
  return impList(s).filter(i => i.alive).length
}

function spawnImps(s: SimAPI, n: number) {
  for (let i = 0; i < n; i++) {
    const imp: ImpToken = { alive: true }
    impList(s).push(imp)
    for (let bolt = 0; bolt < 5; bolt++) {
      s.schedule(s.time + 0.8 + bolt * 1.4, () => {
        if (imp.alive) s.damage('Wild Imp', IMP_BOLT)
      })
    }
    s.schedule(s.time + IMP_LIFESPAN, () => {
      if (!imp.alive) return
      imp.alive = false
      // S2 4pc: expiring imps sometimes fling themselves at the target
      if (s.rng('imp_4pc') < 0.20) s.damage('Implosion', IMPLOSION_PER_IMP * 2.5)
    })
  }
}

/** Diabolist: spending shards charges the next Demonic Art */
function trackDiabolic(s: SimAPI, spent: number) {
  s.data.diabolic = (s.data.diabolic ?? 0) + spent
  if (s.data.diabolic >= DEMONIC_ART_COST) {
    s.data.diabolic -= DEMONIC_ART_COST
    s.applyAura('player', 'demonic_art')
  }
}

/** is the Hand of Gul'dan button currently in its Ruination form? */
function ruinationReady(s: SimAPI): boolean {
  return s.auraRemains('player', 'ruination') > 0
}

export const demonologyWarlock: SpecConfig = {
  name: 'Demonology Warlock',
  specId: 'warlock-demonology',
  specIcon: 'spell_shadow_metamorphosis',
  resourceName: 'Soul Shards',
  resourceMax: 5,
  startingResource: 3,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/warlock/demonology/rotation-cooldowns-pve-dps',
    buildName: 'Diabolist Raid Single Target',
    heroTalent: 'Diabolist',
    // published verbatim by kalamazi.gg ("Diabolist Single Target")
    talentString: 'EAORKUURVURVUVRBVFWYUBROVFFWhVQFQWFRHQBAFFVVVUBE',
    retrieved: '2026-08-24',
  },

  onCombatStart: (s) => {
    // fresh imp roster per run, then start the Felguard auto-attack loop
    impBank.set(s.data, [])
    const swing = () => {
      s.damage('Felguard', FELGUARD_SWING)
      s.schedule(s.time + 2.0 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.5, swing)
  },

  auras: [
    { id: 'demonic_core', name: 'Demonic Core', icon: 'warlock_spelldrain', duration: 20, maxStacks: 4 },
    { id: 'demonic_art', name: 'Demonic Art', icon: 'ability_warlock_demonicpower', duration: 30 },
    { id: 'ruination', name: 'Ruination', icon: 'spell_fire_felflamering', duration: 30 },
    { id: 'infernal_bolt', name: 'Infernal Bolt', icon: 'spell_fel_firebolt', duration: 30 },
    { id: 'dreadstalkers', name: 'Dreadstalkers', icon: 'spell_warlock_calldreadstalkers', duration: 12 },
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
        }
        s.gain(2, 'demonbolt')
        s.damage('demonbolt', DB_COEFF)
      },
    },
    {
      // One button, as in game: the Pit Lord's Ruination transforms it.
      id: 'hand_of_guldan',
      name: "Hand of Gul'dan",
      icon: 'ability_warlock_handofguldan',
      spellId: 105174,
      castTime: 1.5,
      cost: 1,
      costMod: (s) => (ruinationReady(s) ? 0 : Math.min(3, Math.max(1, Math.floor(s.insanity)))),
      displayName: (s) => (ruinationReady(s) ? 'Ruination' : "Hand of Gul'dan"),
      displayIcon: (s) => (ruinationReady(s) ? 'spell_fire_felflamering' : 'ability_warlock_handofguldan'),
      // shards paid are read at cast start (cost is deducted before onResolve)
      onCastStart: (s) => {
        s.data.hog_ruin = ruinationReady(s) ? 1 : 0
        s.data.hog_paid = s.data.hog_ruin ? 0 : Math.min(3, Math.max(1, Math.floor(s.insanity)))
      },
      onResolve: (s) => {
        if (s.data.hog_ruin) {
          s.removeAura('player', 'ruination')
          s.damage('Ruination', RUINATION_COEFF)
          spawnImps(s, 3)
          return
        }
        const paid = s.data.hog_paid ?? 1
        s.damage('hand_of_guldan', HOG_IMPACT * paid)
        spawnImps(s, paid)
        trackDiabolic(s, paid)
        // Dominion of Argus R3: HoG refunds 1 shard inside the Tyrant window
        if (s.auraRemains('player', 'demonic_tyrant') > 0) s.gain(1, 'dominion_of_argus')
        // a charged Demonic Art resolves on the next paid Hand of Gul'dan
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
      },
    },
    {
      id: 'infernal_bolt',
      name: 'Infernal Bolt',
      icon: 'spell_fel_firebolt',
      spellId: 434506,
      castTime: 2.0,
      usable: (s) => (s.auraRemains('player', 'infernal_bolt') > 0 ? true : 'needs Mother of Chaos'),
      onResolve: (s) => {
        s.removeAura('player', 'infernal_bolt')
        s.damage('infernal_bolt', INFERNAL_BOLT_COEFF)
        s.gain(3, 'infernal_bolt')
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
        s.applyAura('player', 'dreadstalkers')
        for (let i = 0; i < 6; i++) {
          s.schedule(s.time + 0.5 + i * 2, () => s.damage('Dreadstalker', STALKER_BITE * 2)) // 2 stalkers
        }
        // despawn hands back 2 Demonic Cores
        s.schedule(s.time + 12.5, () => s.applyAura('player', 'demonic_core', { stacks: 2 }))
      },
    },
    {
      id: 'grimoire_imp_lord',
      name: 'Grimoire: Imp Lord',
      icon: 'inv_imp3_purple',
      spellId: 1231871,
      cooldown: 60, // APPROX: paired with Tyrant every cycle per guides
      onResolve: (s) => {
        for (let i = 0; i < 10; i++) {
          s.schedule(s.time + 1 + i * 2, () => s.damage('Imp Lord', IMP_LORD_HIT))
        }
      },
    },
    {
      id: 'power_siphon',
      name: 'Power Siphon',
      icon: 'ability_warlock_backdraft',
      spellId: 264130,
      cooldown: 30,
      usable: (s) => (impCount(s) >= 2 ? true : 'needs 2 Wild Imps'),
      onResolve: (s) => {
        let eaten = 0
        for (const imp of impList(s)) {
          if (eaten >= 2) break
          if (imp.alive) {
            imp.alive = false
            eaten++
          }
        }
        s.applyAura('player', 'demonic_core', { stacks: eaten })
      },
    },
    {
      id: 'implosion',
      name: 'Implosion',
      icon: 'inv_implosion',
      spellId: 196277,
      usable: (s) => (impCount(s) >= 1 ? true : 'no Wild Imps out'),
      onResolve: (s) => {
        let n = 0
        for (const imp of impList(s)) {
          if (imp.alive) {
            imp.alive = false
            n++
          }
        }
        s.damage('Implosion', IMPLOSION_PER_IMP * n)
      },
    },
    {
      id: 'summon_doomguard',
      name: 'Summon Doomguard',
      icon: 'warlock_summon_doomguard',
      spellId: 1227087,
      cooldown: 120,
      onResolve: (s) => {
        for (let i = 0; i < 8; i++) {
          s.schedule(s.time + 1 + i * 2.5, () => s.damage('Doomguard', DOOM_BOLT))
        }
      },
    },
    {
      id: 'summon_demonic_tyrant',
      name: 'Summon Demonic Tyrant',
      icon: 'inv_summondemonictyrant',
      spellId: 265187,
      castTime: 2.0,
      cooldown: 60, // APPROX
      onResolve: (s) => {
        s.applyAura('player', 'demonic_tyrant')
        s.damage('Demonic Tyrant', TYRANT_HIT)
        for (let i = 0; i < 15; i++) {
          s.schedule(s.time + 1 + i, () => s.damage('Demonic Tyrant', TYRANT_PULSE))
        }
      },
    },
  ],

  actionBar: [
    'shadow_bolt', 'demonbolt', 'hand_of_guldan', 'implosion', 'call_dreadstalkers',
    'power_siphon', 'grimoire_imp_lord', 'infernal_bolt', 'summon_doomguard',
    'summon_demonic_tyrant',
  ],

  // Tyrant empowers your demons (flat window APPROX); Doomguard ignores it
  damageMult: (s, spellId) =>
    (s.auraRemains('player', 'demonic_tyrant') > 0 && spellId !== 'Doomguard' ? TYRANT_MULT : 1),

  glows: (s, id) => {
    switch (id) {
      case 'demonbolt': return s.stacks('player', 'demonic_core') > 0
      case 'hand_of_guldan': return ruinationReady(s) || s.insanity >= 3
      case 'infernal_bolt': return s.auraRemains('player', 'infernal_bolt') > 0
      case 'implosion': return impCount(s) >= 6
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'call_dreadstalkers', text: 'On cooldown (2 shards) — they hand back Demonic Cores', when: s => s.cooldownRemains('call_dreadstalkers') === 0 && s.insanity >= 2 },
    { abilityId: 'grimoire_imp_lord', text: 'On cooldown — line it up with Tyrant', when: s => s.cooldownRemains('grimoire_imp_lord') === 0 },
    { abilityId: 'summon_doomguard', text: 'On cooldown (2 min) — he ignores Tyrant, just send him', when: s => s.cooldownRemains('summon_doomguard') === 0 },
    { abilityId: 'summon_demonic_tyrant', text: 'With Dreadstalkers out and 5 shards banked — chain HoG inside', when: s => s.cooldownRemains('summon_demonic_tyrant') === 0 && s.auraRemains('player', 'dreadstalkers') > 0 },
    { abilityId: 'power_siphon', text: 'At ≤2 Demonic Cores with 2+ imps out', when: s => s.cooldownRemains('power_siphon') === 0 && impCount(s) >= 2 && s.stacks('player', 'demonic_core') <= 2 },
    { abilityId: 'implosion', text: 'With 6+ Wild Imps out (2pc/4pc love it)', when: s => impCount(s) >= 6 },
    { abilityId: 'hand_of_guldan', label: 'Ruination', icon: 'spell_fire_felflamering', text: 'Free after the Pit Lord — press it', when: s => ruinationReady(s) },
    { abilityId: 'hand_of_guldan', text: 'At 5 shards — never overcap (unless Tyrant is imminent)' },
    { abilityId: 'infernal_bolt', text: 'At ≤2 shards when Mother of Chaos grants it (+3 shards)', when: s => s.auraRemains('player', 'infernal_bolt') > 0 && s.insanity <= 2 },
    { abilityId: 'demonbolt', text: 'Spend Demonic Cores at 2+ stacks (instant, +2 shards)', when: s => s.stacks('player', 'demonic_core') >= 2 },
    { abilityId: 'hand_of_guldan', text: 'At 3 shards', when: s => s.insanity >= 3 },
    { abilityId: 'shadow_bolt', text: 'Filler — always be casting' },
  ],

  /** Oracle — Maxroll/Icy Veins 12.1 ST priority for Diabolist. */
  policy: (s) => {
    const shards = Math.floor(s.insanity)
    const cores = s.stacks('player', 'demonic_core')
    const tyrantCd = s.cooldownRemains('summon_demonic_tyrant')
    const stalkersUp = s.auraRemains('player', 'dreadstalkers') > 0

    // demons out before the Tyrant eats them
    if (s.cooldownRemains('call_dreadstalkers') === 0 && shards >= 2) return 'call_dreadstalkers'
    if (s.cooldownRemains('grimoire_imp_lord') === 0) return 'grimoire_imp_lord'
    if (s.cooldownRemains('summon_doomguard') === 0) return 'summon_doomguard'
    if (tyrantCd === 0 && stalkersUp && shards >= 5) return 'summon_demonic_tyrant'

    // imp economy
    if (s.cooldownRemains('power_siphon') === 0 && impCount(s) >= 2 && cores <= 2) return 'power_siphon'
    if (impCount(s) >= 6) return 'implosion'

    // spenders
    if (ruinationReady(s)) return 'hand_of_guldan'
    if (shards >= 5 && tyrantCd > 8) return 'hand_of_guldan'
    if (s.auraRemains('player', 'infernal_bolt') > 0 && shards <= 2) return 'infernal_bolt'
    if (cores >= 2) return 'demonbolt'
    if (shards >= 3 && tyrantCd > 8) return 'hand_of_guldan'
    return 'shadow_bolt'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['shadow_bolt', 'demonbolt', 'infernal_bolt']
    const summons = ['call_dreadstalkers', 'grimoire_imp_lord', 'summon_doomguard']
    const impSpend = ['implosion', 'power_siphon']
    const sets = [builders, summons, impSpend]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
