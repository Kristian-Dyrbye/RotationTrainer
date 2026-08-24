import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Balance Druid — patch 12.1.0 (Midnight, Season 2), Keeper of the Grove
 * raid ST build (alternate build; default spec.ts = Elune's Chosen) with
 * the S2 "Bark of the Enigmatic Dreamwatcher" tier 2pc+4pc.
 * Sources (verified 2026-08-24):
 *  - Wowhead rotation guide (its "typical ST" list assumes Keeper of the
 *    Grove): https://www.wowhead.com/guide/classes/druid/balance/rotation-cooldowns-pve-dps
 *  - Method (primary rotation source — publishes the Keeper ST priority):
 *    https://www.method.gg/guides/balance-druid/playstyle-and-rotation
 *  - Icy Veins rotation: https://www.icy-veins.com/wow/balance-druid-pve-dps-rotation-cooldowns-abilities
 *  - Icy Veins builds: https://www.icy-veins.com/wow/balance-druid-pve-dps-spec-builds-talents
 *    (publishes a Keeper of the Grove string only as a CLEAVE build — no
 *    raid-ST Keeper string is published anywhere I could verify, so
 *    talentString is omitted rather than mislabeled)
 *
 * Keeper of the Grove vs the default Elune's Chosen build: NO Lunar
 * Calling — the build runs traditional Eclipse with Wrath as the ST filler
 * and enters SOLAR Eclipse. Force of Nature is the hero-defining button:
 * treants buff you while active (Harmony of the Grove, +12% damage per
 * Method) and grant 3 charges of Dream Surge, causing your next Wraths to
 * explode in a Dream Burst (+30% Dream Burst damage in 12.1). Cenarius'
 * Might grants 6% haste when you enter an Eclipse (12.1 nerf from 8%).
 * Method's ST priority modeled: DoTs → Force of Nature with Celestial
 * Alignment or Eclipse → Fury of Elune aligned with Eclipse/FoN →
 * Celestial Alignment right after FoN → Convoke with FoN+CA → enter
 * (Solar) Eclipse at 2 charges or with resources to dump Ascendant
 * Eclipse stacks → free procs on Starfall → Starsurge main spender (spend
 * all 3 Ascendant stacks early, never cap AP) → Wrath filler.
 *
 * Shared 12.x mechanics reused from the base file: Eclipse is an activated
 * 2-charge ability (~32s recharge), Moonfire/Sunfire generate 0 AP,
 * Astral Communion (cap 120), Shooting Stars + Orbit Breaker, Starweaver,
 * Touch the Cosmos, Starlord, Fury of Elune + Boundless Moonlight,
 * Convoke, Apex: Ascendant Eclipses, Nature's Balance, Power of Goldrinn,
 * S2 2pc (Starsurge +20%) and 4pc (Eclipse damage wave). Keeper swaps:
 * Incarnation/Whirling Stars (Elune's Chosen) → Celestial Alignment on a
 * flat 120s; Force of Nature on ~45s (Early Spring). APPROX: all damage
 * coefficients, treant melee condensed to an aura tick, Dream Burst
 * coefficient, FoN duration/cooldown numbers, Cenarius' Might duration,
 * Starlord retained from the base build, Wrath AP gen, Convoke condensed
 * to a 16-tick channel, proc rates. The player starts in Moonkin Form.
 */

const ECLIPSE_FILLER_MULT = 1.15 * 1.4 // Grove's Inspiration +15%, Wrath +40% in Solar Eclipse (APPROX)
const SS_COEFF = 3.676 * 1.2           // S2 2pc: Starsurge +20%
const STARFALL_WAVE = 0.27
const GOLDRINN_COEFF = 2.17
const SHOOTING_STAR = 0.68
const FULL_MOON_ORBIT = 4.2294 * 0.5   // Orbit Breaker: Full Moon at 50%
const CONVOKE_TICK = 0.75              // APPROX: 16-cast channel condensed
const DREAM_BURST = 1.9                // APPROX: Dream Surge explosion (12.1: +30% buff folded in)
const TREANT_SWING = 0.32              // APPROX: 3 treants' melee condensed into one pulse
const HARMONY_MULT = 1.12              // Harmony of the Grove: +12% while treants active (Method)

function eclipseUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'solar_eclipse') > 0 || s.auraRemains('player', 'celestial_alignment') > 0
}

/** shared handling for Moonfire/Sunfire ticks: Shooting Stars @17%, Orbit Breaker every 30th star */
function dotTick(s: SimAPI, dotId: string, coeff: number) {
  s.damage(dotId, coeff)
  if (s.rng('shooting_stars') < 0.17) {
    s.schedule(s.time + 0.8, () => s.damage('Shooting Star', SHOOTING_STAR))
    s.gain(2, 'shooting_stars')
    s.data.orbit = (s.data.orbit ?? 0) + 1
    if (s.data.orbit >= 30) {
      s.data.orbit -= 30
      s.schedule(s.time + 1.2, () => s.damage('Full Moon (Orbit Breaker)', FULL_MOON_ORBIT))
    }
  }
}

/** spender empowerment: Ascendant Stars (+20% for 3 spenders per Eclipse) */
function ascendantMult(s: SimAPI): number {
  if (s.stacks('player', 'ascendant_stars') > 0) {
    s.consumeStack('player', 'ascendant_stars')
    return 1.2
  }
  return 1
}

function onSpender(s: SimAPI) {
  s.applyAura('player', 'starlord', { stacks: 1 })
}

function enterEclipse(s: SimAPI) {
  s.applyAura('player', 'solar_eclipse')
  // Cenarius' Might: 6% haste on entering an Eclipse (12.1)
  s.applyAura('player', 'cenarius_might')
  // Apex R1: 3 empowered spenders + next filler instant
  s.applyAura('player', 'ascendant_stars', { stacks: 3 })
  s.applyAura('player', 'ascendant_fires')
  // Apex R3: Lunar Bolts — 3 bolts, always crit
  for (let i = 0; i < 3; i++) {
    s.schedule(s.time + 0.5 + i * 0.2, () => s.damage('Lunar Bolt', 1.0 * s.stats.critMult))
  }
}

export const balanceKeeper: SpecConfig = {
  name: 'Balance Druid',
  specId: 'druid-balance',
  specIcon: 'spell_nature_starfall',
  buildId: 'keeper-of-the-grove',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/druid/balance/rotation-cooldowns-pve-dps',
    buildName: 'Keeper of the Grove Raid Single-Target (Solar Eclipse, Wrath filler)',
    heroTalent: 'Keeper of the Grove',
    // no verbatim raid-ST Keeper string is published (Icy Veins' Keeper
    // string is labeled Cleave), so none is cited here
    retrieved: '2026-08-24',
  },
  resourceName: 'Astral Power',
  resourceMax: 120, // Astral Communion
  startingResource: 50,

  onCombatStart: (s) => {
    s.applyAura('player', 'moonkin_form')
    // Nature's Balance: 1 AP per 2s while in combat
    const natures = () => {
      s.gain(1, 'natures_balance')
      s.schedule(s.time + 2, natures)
    }
    s.schedule(s.time + 2, natures)
  },

  auras: [
    { id: 'moonkin_form', name: 'Moonkin Form', icon: 'spell_nature_forceofnature', duration: Infinity },
    {
      id: 'moonfire_dot', name: 'Moonfire', icon: 'spell_nature_starfall', duration: 18, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => dotTick(s, 'moonfire_dot', 0.184) },
    },
    {
      id: 'sunfire_dot', name: 'Sunfire', icon: 'ability_mage_firestarter', duration: 18, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => dotTick(s, 'sunfire_dot', 0.184) },
    },
    { id: 'solar_eclipse', name: 'Solar Eclipse', icon: 'ability_druid_eclipseorange', duration: 15 },
    { id: 'celestial_alignment', name: 'Celestial Alignment', icon: 'spell_nature_natureguardian', duration: 15 },
    { id: 'cenarius_might', name: "Cenarius' Might", icon: 'spell_nature_naturetouchgrow', duration: 8 },
    {
      id: 'force_of_nature', name: 'Force of Nature', icon: 'ability_druid_forceofnature', duration: 10,
      onApply: s => s.applyAura('player', 'dream_surge', { stacks: 3 }),
      tick: { interval: 0.75, hasted: true, onTick: s => s.damage('Treant Melee', TREANT_SWING) },
    },
    { id: 'dream_surge', name: 'Dream Surge', icon: 'inv_10_herb_seed_magiccolor5', duration: 20, maxStacks: 3 },
    { id: 'ascendant_stars', name: 'Ascendant Stars', icon: 'inv12_apextalent_druid_ascendanceeclipses', duration: 15, maxStacks: 3 },
    { id: 'ascendant_fires', name: 'Ascendant Fires', icon: 'inv12_apextalent_druid_ascendanceeclipses', duration: 15 },
    { id: 'starweavers_warp', name: "Starweaver's Warp", icon: 'ability_druid_starfall', duration: 15 },
    { id: 'starweavers_weft', name: "Starweaver's Weft", icon: 'spell_arcane_arcane03', duration: 15 },
    { id: 'touch_the_cosmos', name: 'Touch the Cosmos', icon: 'ability_bossgorefiend_touchofdoom', duration: 15 },
    { id: 'starlord', name: 'Starlord', icon: 'spell_shaman_measuredinsight', duration: 15, maxStacks: 3 },
    {
      id: 'starfall_active', name: 'Starfall', icon: 'ability_druid_starfall', duration: 8,
      tick: { interval: 0.9, hasted: false, onTick: s => s.damage('starfall', STARFALL_WAVE) },
    },
    {
      id: 'fury_of_elune', name: 'Fury of Elune', icon: 'ability_druid_dreamstate', duration: 8,
      tick: { interval: 0.5, hasted: false, onTick: s => { s.damage('fury_of_elune', 0.1834); s.gain(2.5, 'foe') } },
      onExpire: s => s.damage('fury_of_elune', 2.1632), // Boundless Moonlight ending blast
    },
  ],

  abilities: [
    {
      id: 'wrath',
      name: 'Wrath',
      icon: 'spell_nature_wrathv2',
      spellId: 190984,
      castTime: 1.5,
      castTimeMod: (s, base) => (s.auraRemains('player', 'ascendant_fires') > 0 ? 0 : base),
      onResolve: (s) => {
        if (s.auraRemains('player', 'ascendant_fires') > 0) s.removeAura('player', 'ascendant_fires')
        s.gain(6, 'wrath') // APPROX: tooltip hides the value
        s.damage('wrath', 1.464 * (eclipseUp(s) ? ECLIPSE_FILLER_MULT : 1))
        // Keeper: Dream Surge — empowered Wraths explode in a Dream Burst
        if (s.stacks('player', 'dream_surge') > 0) {
          s.consumeStack('player', 'dream_surge')
          s.schedule(s.time + 0.3, () => s.damage('Dream Burst', DREAM_BURST))
        }
        if (s.rng('touch_the_cosmos') < 0.12) s.applyAura('player', 'touch_the_cosmos')
      },
    },
    {
      id: 'starsurge',
      name: 'Starsurge',
      icon: 'spell_arcane_arcane03',
      spellId: 78674,
      cost: 40,
      costMod: (s) => (s.auraRemains('player', 'starweavers_weft') > 0 || s.auraRemains('player', 'touch_the_cosmos') > 0 ? 0 : 40),
      onResolve: (s) => {
        if (s.auraRemains('player', 'starweavers_weft') > 0) s.removeAura('player', 'starweavers_weft')
        else if (s.auraRemains('player', 'touch_the_cosmos') > 0) s.removeAura('player', 'touch_the_cosmos')
        s.damage('starsurge', SS_COEFF * ascendantMult(s))
        onSpender(s)
        if (s.rng('goldrinn') < 0.33) s.schedule(s.time + 0.5, () => s.damage('Power of Goldrinn', GOLDRINN_COEFF))
        if (s.rng('starweaver_warp') < 0.20) s.applyAura('player', 'starweavers_warp')
      },
    },
    {
      id: 'starfall',
      name: 'Starfall',
      icon: 'ability_druid_starfall',
      spellId: 191034,
      cost: 50,
      costMod: (s) => (s.auraRemains('player', 'starweavers_warp') > 0 || s.auraRemains('player', 'touch_the_cosmos') > 0 ? 0 : 50),
      onResolve: (s) => {
        if (s.auraRemains('player', 'starweavers_warp') > 0) s.removeAura('player', 'starweavers_warp')
        else if (s.auraRemains('player', 'touch_the_cosmos') > 0) s.removeAura('player', 'touch_the_cosmos')
        s.damage('starfall', 0.304 * ascendantMult(s)) // S2 2pc instant hit
        s.applyAura('player', 'starfall_active')
        onSpender(s)
        if (s.rng('starweaver_weft') < 0.40) s.applyAura('player', 'starweavers_weft')
      },
    },
    {
      id: 'moonfire',
      name: 'Moonfire',
      icon: 'spell_nature_starfall',
      spellId: 8921,
      onResolve: (s) => {
        s.damage('moonfire', 0.212)
        s.applyAura('target', 'moonfire_dot')
      },
    },
    {
      id: 'sunfire',
      name: 'Sunfire',
      icon: 'ability_mage_firestarter',
      spellId: 93402,
      onResolve: (s) => {
        s.damage('sunfire', 0.212)
        s.applyAura('target', 'sunfire_dot')
      },
    },
    {
      id: 'eclipse',
      name: 'Eclipse',
      icon: 'ability_druid_eclipse',
      spellId: 1233272,
      cooldown: 32, // 12.x baseline: 2-charge active ability, 32s recharge
      charges: 2,
      usable: (s) => (eclipseUp(s) ? 'an Eclipse is already active' : true),
      onResolve: (s) => enterEclipse(s),
    },
    {
      id: 'force_of_nature',
      name: 'Force of Nature',
      icon: 'ability_druid_forceofnature',
      spellId: 205636,
      cooldown: 45, // Early Spring (APPROX)
      onResolve: (s) => s.applyAura('player', 'force_of_nature'),
    },
    {
      id: 'celestial_alignment',
      name: 'Celestial Alignment',
      icon: 'spell_nature_natureguardian',
      spellId: 194223,
      cooldown: 120,
      onResolve: (s) => {
        s.applyAura('player', 'celestial_alignment')
        enterEclipse(s)
      },
    },
    {
      id: 'convoke',
      name: 'Convoke the Spirits',
      icon: 'inv_ability_druid_convokethespirits',
      spellId: 391528,
      cooldown: 120,
      channel: { duration: 4, ticks: 16, hasted: false, onTick: s => s.damage('convoke', CONVOKE_TICK) },
      onResolve: () => {},
    },
    {
      id: 'fury_of_elune',
      name: 'Fury of Elune',
      icon: 'ability_druid_dreamstate',
      spellId: 202770,
      cooldown: 60,
      onResolve: (s) => s.applyAura('player', 'fury_of_elune'),
    },
  ],

  actionBar: [
    'wrath', 'starsurge', 'starfall', 'moonfire', 'sunfire',
    'eclipse', 'force_of_nature', 'celestial_alignment', 'convoke', 'fury_of_elune',
  ],

  damageMult: (s) => {
    let m = 1.10 // Moonkin Form +10% spell damage (always in form)
    if (s.auraRemains('player', 'celestial_alignment') > 0) m *= 1.10
    // Keeper: Harmony of the Grove — +12% while your treants are active
    if (s.auraRemains('player', 'force_of_nature') > 0) m *= HARMONY_MULT
    // S2 4pc: +10% in Eclipse, waning to +2% at the midpoint and back
    const ecl = s.aura('player', 'solar_eclipse') ?? s.aura('player', 'celestial_alignment')
    if (ecl) {
      const total = ecl.expiresAt - ecl.appliedAt
      const p = Math.max(0, Math.min(1, (s.time - ecl.appliedAt) / total))
      m *= 1 + 0.02 + 0.08 * Math.abs(2 * p - 1)
    }
    return m
  },
  hasteMod: (s) =>
    (s.auraRemains('player', 'celestial_alignment') > 0 ? 0.10 : 0)
    + (s.auraRemains('player', 'cenarius_might') > 0 ? 0.06 : 0)
    + 0.02 * s.stacks('player', 'starlord'),

  glows: (s, id) => {
    switch (id) {
      case 'starsurge': return s.auraRemains('player', 'starweavers_weft') > 0 || s.auraRemains('player', 'touch_the_cosmos') > 0
      case 'starfall': return s.auraRemains('player', 'starweavers_warp') > 0
      case 'wrath': return s.auraRemains('player', 'ascendant_fires') > 0 || s.stacks('player', 'dream_surge') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'sunfire', text: 'Keep up — refresh in pandemic (<5.4s), ideally outside Eclipse' },
    { abilityId: 'moonfire', text: 'Keep up — refresh in pandemic (<5.4s), ideally outside Eclipse' },
    { abilityId: 'force_of_nature', text: 'Pair with Celestial Alignment; if CA is far away, use with an Eclipse instead', when: s => s.cooldownRemains('force_of_nature') === 0 },
    { abilityId: 'fury_of_elune', text: 'On cooldown inside an Eclipse — ~40 Astral Power into the window', when: s => s.cooldownRemains('fury_of_elune') === 0 },
    { abilityId: 'celestial_alignment', text: 'Right after Force of Nature (Harmony of the Grove running)', when: s => s.cooldownRemains('celestial_alignment') === 0 },
    { abilityId: 'convoke', text: 'Inside Celestial Alignment + treants while under 40 AP', when: s => s.cooldownRemains('convoke') === 0 },
    { abilityId: 'eclipse', text: 'Enter Solar Eclipse at 2 charges or with enough AP to dump the Ascendant stacks', when: s => s.cooldownRemains('eclipse') === 0 },
    { abilityId: 'starfall', text: 'Free proc (Starweaver’s Warp) — cast even on single target', when: s => s.auraRemains('player', 'starweavers_warp') > 0 },
    { abilityId: 'starsurge', text: 'Spend in Eclipse (all 3 Ascendant stacks early); consume free procs; never cap AP (spend above ~98)' },
    { abilityId: 'wrath', text: 'Filler — always be casting; Dream Surge Wraths explode in a Dream Burst' },
  ],

  policy: (s) => {
    // never clip an in-progress Convoke
    if (s.casting?.channel && s.casting.abilityId === 'convoke') return null
    const ecl = eclipseUp(s)
    const sfRemains = s.auraRemains('target', 'sunfire_dot')
    const mfRemains = s.auraRemains('target', 'moonfire_dot')
    const caUp = s.auraRemains('player', 'celestial_alignment') > 0
    const caCd = s.cooldownRemains('celestial_alignment')
    const treants = s.auraRemains('player', 'force_of_nature') > 0

    if (sfRemains < 2 || (sfRemains < 5.4 && !ecl)) return 'sunfire'
    if (mfRemains < 2 || (mfRemains < 5.4 && !ecl)) return 'moonfire'
    // Force of Nature: pair with CA (ready, active, or about to be pressed);
    // once CA is far away, pair with an Eclipse instead (Method)
    if (s.cooldownRemains('force_of_nature') === 0
      && (caCd === 0 || caUp || (caCd > 30 && ecl))) return 'force_of_nature'
    if (s.cooldownRemains('fury_of_elune') === 0 && ecl) return 'fury_of_elune'
    if (caCd === 0 && treants && s.insanity >= 40) return 'celestial_alignment'
    if (caUp && s.insanity < 40
      && s.isUsable('convoke') === true && s.timeToUsable('convoke') === 0) return 'convoke'
    if (s.isUsable('eclipse') === true && s.timeToUsable('eclipse') === 0
      && (s.chargesOf('eclipse') === 2 || s.insanity >= 60)) return 'eclipse'
    if (s.auraRemains('player', 'starweavers_warp') > 0) return 'starfall'
    if (s.auraRemains('player', 'touch_the_cosmos') > 0 || s.auraRemains('player', 'starweavers_weft') > 0) return 'starsurge'
    if (ecl && s.insanity >= 40) return 'starsurge'
    if (!ecl && s.insanity > 98) return 'starsurge' // anti-overcap
    return 'wrath'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const dots = ['moonfire', 'sunfire']
    const spenders = ['starsurge', 'starfall']
    const sets = [dots, spenders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
