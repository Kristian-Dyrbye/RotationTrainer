import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Demonology Warlock — patch 12.1.0 (Midnight, Season 2), Soul Harvester
 * raid single-target build (alternate to the default Diabolist build).
 * Verified against live guides 2026-08-24:
 *  - Wowhead rotation guide: https://www.wowhead.com/guide/classes/warlock/demonology/rotation-cooldowns-pve-dps
 *  - Method: https://www.method.gg/guides/demonology-warlock/playstyle-and-rotation
 *  - Icy Veins: https://www.icy-veins.com/wow/demonology-warlock-pve-dps-rotation-cooldowns-abilities
 *  - Kalamazi (talent string + opener): https://www.kalamazi.gg/guides/demonology
 *  - Timesaver S2 guide (Soul Harvester mechanics): https://timesaver.gg/blog/wow-midnight-season-2-demonology-warlock-guide
 *
 * Soul Harvester: your demons' souls feed you. Summoned/expiring Wild
 * Imps grant Succulent Souls; your next Shadow Bolt or Demonbolt
 * consumes one as a Demonic Soul — bonus Shadow damage (Wicked Reaping)
 * and the Soul Anathema DoT. Shadow of Death (capstone): Summon Demonic
 * Tyrant GENERATES 3 Soul Shards, so cast it at ≤2 shards and enter the
 * window near-capped (build to 4, not 5, in the opener). Otherwise the
 * core demo loop is unchanged: Call Dreadstalkers on cooldown, Grimoire:
 * Imp Lord + Doomguard on cooldown, chain Hand of Gul'dan (Dominion of
 * Argus refunds inside the Tyrant window), Power Siphon at 2+ imps,
 * Implosion at 6+. No Diabolist rituals: no Demonic Art, Ruination,
 * Mother of Chaos, or Infernal Bolt.
 * S2 tier: 2pc Wild Imps +10% / Implosion +20% (folded into
 * coefficients); 4pc expiring imps have a 20% chance to self-Implode.
 * APPROX: pet cadences and coefficients, Succulent Soul proc rates
 * (30%/imp summoned, 20%/imp expiry, 1 per Dreadstalkers), Demonic Soul
 * and Soul Anathema coefficients, Imp Lord & Tyrant cooldowns, Tyrant
 * window as flat +15% (excl. Doomguard).
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
const DEMONIC_SOUL_COEFF = 0.85 // Demonic Soul burst incl. Wicked Reaping
const ANATHEMA_TICK = 0.32      // Soul Anathema DoT tick
const SOUL_MAX_STACKS = 3
const SOUL_ON_SUMMON = 0.30     // APPROX: chance per Wild Imp summoned
const SOUL_ON_EXPIRE = 0.20     // APPROX: chance per Wild Imp natural expiry

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
    // Succulent Souls: summoned demons sometimes shed a soul (APPROX rate)
    if (s.rng('succulent_soul') < SOUL_ON_SUMMON) s.applyAura('player', 'succulent_soul', { stacks: 1 })
    for (let bolt = 0; bolt < 5; bolt++) {
      s.schedule(s.time + 0.8 + bolt * 1.4, () => {
        if (imp.alive) s.damage('Wild Imp', IMP_BOLT)
      })
    }
    s.schedule(s.time + IMP_LIFESPAN, () => {
      if (!imp.alive) return
      imp.alive = false
      // Soul Harvester reaps expiring demons (APPROX rate)
      if (s.rng('succulent_expire') < SOUL_ON_EXPIRE) s.applyAura('player', 'succulent_soul', { stacks: 1 })
      // S2 4pc: expiring imps sometimes fling themselves at the target
      if (s.rng('imp_4pc') < 0.20) s.damage('Implosion', IMPLOSION_PER_IMP * 2.5)
    })
  }
}

/** consume a Succulent Soul on Shadow Bolt / Demonbolt (Demonic Soul) */
function reapSoul(s: SimAPI) {
  if (s.stacks('player', 'succulent_soul') <= 0) return
  s.consumeStack('player', 'succulent_soul')
  s.damage('Demonic Soul', DEMONIC_SOUL_COEFF) // incl. Wicked Reaping
  s.applyAura('target', 'soul_anathema')
}

function soulReady(s: SimAPI): boolean {
  return s.stacks('player', 'succulent_soul') > 0
}

export const demonologySoulHarvester: SpecConfig = {
  name: 'Demonology Warlock',
  specId: 'warlock-demonology',
  specIcon: 'spell_shadow_metamorphosis',
  buildId: 'soul-harvester',
  resourceName: 'Soul Shards',
  resourceMax: 5,
  startingResource: 3,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/warlock/demonology/rotation-cooldowns-pve-dps',
    buildName: 'Soul Harvester Raid Single Target',
    heroTalent: 'Soul Harvester',
    // published verbatim by kalamazi.gg ("Soul Harvester Single Target Demonology")
    talentString: 'EAORKURRVVRFUVGIUBQOVFFWFVEUZGFQHQBQFFVVVUBU',
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
    {
      id: 'succulent_soul', name: 'Succulent Soul', icon: 'inv_ability_soulharvesterwarlock_demonicsoul',
      duration: 25, maxStacks: SOUL_MAX_STACKS,
    },
    {
      id: 'soul_anathema', name: 'Soul Anathema', icon: 'spell_shadow_soulleech_3',
      duration: 10, rollover: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('soul_anathema', ANATHEMA_TICK) },
    },
    { id: 'dreadstalkers', name: 'Dreadstalkers', icon: 'spell_warlock_calldreadstalkers', duration: 12 },
    { id: 'demonic_tyrant', name: 'Demonic Tyrant', icon: 'inv_summondemonictyrant', duration: 15 },
  ],

  abilities: [
    {
      // One button: a held Succulent Soul empowers the resolve (Demonic Soul)
      id: 'shadow_bolt',
      name: 'Shadow Bolt',
      icon: 'spell_shadow_shadowbolt',
      spellId: 686,
      castTime: 2.0,
      displayStacks: (s) => s.stacks('player', 'succulent_soul'),
      onResolve: (s) => {
        s.gain(1, 'shadow_bolt')
        s.damage('shadow_bolt', SB_COEFF)
        reapSoul(s)
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
        reapSoul(s)
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
        // Dominion of Argus R3: HoG refunds 1 shard inside the Tyrant window
        if (s.auraRemains('player', 'demonic_tyrant') > 0) s.gain(1, 'dominion_of_argus')
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
        s.applyAura('player', 'dreadstalkers')
        // Soul Harvester reaps the pack: one guaranteed Succulent Soul
        s.applyAura('player', 'succulent_soul', { stacks: 1 })
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
        // Shadow of Death: the Tyrant GENERATES 3 shards — cast at ≤2
        s.gain(3, 'shadow_of_death')
        s.damage('Demonic Tyrant', TYRANT_HIT)
        for (let i = 0; i < 15; i++) {
          s.schedule(s.time + 1 + i, () => s.damage('Demonic Tyrant', TYRANT_PULSE))
        }
      },
    },
  ],

  actionBar: [
    'shadow_bolt', 'demonbolt', 'hand_of_guldan', 'implosion', 'call_dreadstalkers',
    'power_siphon', 'grimoire_imp_lord', 'summon_doomguard', 'summon_demonic_tyrant',
  ],

  // Tyrant empowers your demons (flat window APPROX); Doomguard ignores it
  damageMult: (s, spellId) =>
    (s.auraRemains('player', 'demonic_tyrant') > 0 && spellId !== 'Doomguard' ? TYRANT_MULT : 1),

  glows: (s, id) => {
    switch (id) {
      case 'demonbolt': return s.stacks('player', 'demonic_core') > 0
      case 'shadow_bolt': return soulReady(s)
      case 'hand_of_guldan': return s.insanity >= 3
      case 'implosion': return impCount(s) >= 6
      case 'summon_demonic_tyrant': return s.cooldownRemains('summon_demonic_tyrant') === 0 && s.insanity <= 2 && s.auraRemains('player', 'dreadstalkers') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'call_dreadstalkers', text: 'On cooldown (2 shards) — Cores back, plus a Succulent Soul', when: s => s.cooldownRemains('call_dreadstalkers') === 0 && s.insanity >= 2 },
    { abilityId: 'grimoire_imp_lord', text: 'On cooldown — line it up with Tyrant', when: s => s.cooldownRemains('grimoire_imp_lord') === 0 },
    { abilityId: 'summon_doomguard', text: 'On cooldown (2 min) — he ignores Tyrant, just send him', when: s => s.cooldownRemains('summon_doomguard') === 0 },
    { abilityId: 'summon_demonic_tyrant', text: 'With Dreadstalkers out at ≤2 shards — Shadow of Death grants 3', when: s => s.cooldownRemains('summon_demonic_tyrant') === 0 && s.auraRemains('player', 'dreadstalkers') > 0 && s.insanity <= 2 },
    { abilityId: 'power_siphon', text: 'At ≤2 Demonic Cores with 2+ imps out', when: s => s.cooldownRemains('power_siphon') === 0 && impCount(s) >= 2 && s.stacks('player', 'demonic_core') <= 2 },
    { abilityId: 'implosion', text: 'With 6+ Wild Imps out (2pc/4pc love it)', when: s => impCount(s) >= 6 },
    { abilityId: 'hand_of_guldan', text: 'At 5 shards — never overcap' },
    { abilityId: 'demonbolt', text: 'Spend Demonic Cores at 2+ stacks — souls make it hit harder', when: s => s.stacks('player', 'demonic_core') >= 2 },
    { abilityId: 'hand_of_guldan', text: 'At 3 shards — keep imps (and souls) flowing', when: s => s.insanity >= 3 },
    { abilityId: 'shadow_bolt', text: 'Filler — each held Succulent Soul empowers it (Demonic Soul)' },
  ],

  /** Oracle — Method/Kalamazi/Timesaver 12.1 ST priority for Soul Harvester. */
  policy: (s) => {
    const shards = Math.floor(s.insanity)
    const cores = s.stacks('player', 'demonic_core')
    const stalkersUp = s.auraRemains('player', 'dreadstalkers') > 0

    // demons out before the Tyrant eats them
    if (s.cooldownRemains('call_dreadstalkers') === 0 && shards >= 2) return 'call_dreadstalkers'
    if (s.cooldownRemains('grimoire_imp_lord') === 0) return 'grimoire_imp_lord'
    if (s.cooldownRemains('summon_doomguard') === 0) return 'summon_doomguard'

    // Shadow of Death: Tyrant generates 3 shards — cast it LOW (≤2) with
    // Dreadstalkers out, entering the window near-capped
    if (s.cooldownRemains('summon_demonic_tyrant') === 0 && stalkersUp && shards <= 2) {
      return 'summon_demonic_tyrant'
    }

    // imp economy
    if (s.cooldownRemains('power_siphon') === 0 && impCount(s) >= 2 && cores <= 2) return 'power_siphon'
    if (impCount(s) >= 6) return 'implosion'

    // spenders — dumping also walks shards down toward the ≤2 Tyrant cast
    if (shards >= 5) return 'hand_of_guldan'
    if (cores >= 2) return 'demonbolt'
    if (shards >= 3) return 'hand_of_guldan'
    return 'shadow_bolt'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['shadow_bolt', 'demonbolt']
    const summons = ['call_dreadstalkers', 'grimoire_imp_lord', 'summon_doomguard']
    const impSpend = ['implosion', 'power_siphon']
    const sets = [builders, summons, impSpend]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
