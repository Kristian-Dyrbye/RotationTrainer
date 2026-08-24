import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Balance Druid — patch 12.1.0 (Midnight, Season 2), Elune's Chosen raid ST
 * build with the S2 "Bark of the Enigmatic Dreamwatcher" tier 2pc+4pc.
 * Sources (verified 2026-08-24):
 *  - Wowhead rotation guide: https://www.wowhead.com/guide/classes/druid/balance/rotation-cooldowns-pve-dps
 *  - Icy Veins rotation: https://www.icy-veins.com/wow/balance-druid-pve-dps-rotation-cooldowns-abilities
 *  - Icy Veins builds (raid ST = Elune's Chosen, source of the import string):
 *    https://www.icy-veins.com/wow/balance-druid-pve-dps-spec-builds-talents
 *  - Maxroll raid guide: https://maxroll.gg/wow/class-guides/balance-druid-raid-guide
 *  - Method: https://www.method.gg/guides/balance-druid/playstyle-and-rotation
 *
 * Key 12.x facts encoded here (TWW priors are wrong): Eclipse is an ACTIVATED
 * ability now (2 charges, ~32s recharge), Moonfire/Sunfire generate 0 AP,
 * and with Lunar Calling the build is Lunar-only — Starfire is the sole
 * filler and Solar Eclipse cannot be entered. Enter Eclipse/Incarnation with
 * high Astral Power and unload spenders immediately; never cap AP (Maxroll:
 * spend above ~82/100 ≈ 98/120 here). Note: Icy Veins + Maxroll recommend
 * Elune's Chosen for raid ST (modeled here); Wowhead/Method's "typical ST"
 * list assumes Keeper of the Grove instead (Force of Nature-centric).
 *
 * Talent assumptions (confirmed on the IV raid ST build): Lunar Calling,
 * Improved Eclipse, Astral Communion (cap 120), Shooting Stars, Orbit
 * Breaker, Starweaver, Touch the Cosmos, Starlord, Fury of Elune +
 * Boundless Moonlight, Convoke, Incarnation. APPROX assumptions kept from
 * pre-S2 research: Nature's Balance, Power of Goldrinn, Whirling Stars
 * (Incarnation 2 charges @120s), Apex: Ascendant Eclipses (3 empowered
 * spenders + instant filler + Lunar Bolts on Eclipse entry). Other APPROX:
 * all damage coefficients, Wrath AP gen, convoke condensed to a 16-tick
 * channel, proc rates. The player starts in Moonkin Form.
 */

const ECLIPSE_FILLER_MULT = 1.15 * 1.4 // Arcane +15%, Starfire +40% in Lunar Eclipse
const LUNAR_CALLING_MULT = 2.2         // Starfire +120% to primary target
const SS_COEFF = 3.676 * 1.2           // S2 2pc: Starsurge +20%
const STARFALL_WAVE = 0.27
const GOLDRINN_COEFF = 2.17
const SHOOTING_STAR = 0.68
const FULL_MOON_ORBIT = 4.2294 * 0.5   // Orbit Breaker: Full Moon at 50%
const CONVOKE_TICK = 0.75              // APPROX: 16-cast channel condensed

function eclipseUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'lunar_eclipse') > 0 || s.auraRemains('player', 'incarnation') > 0
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
  s.applyAura('player', 'lunar_eclipse')
  // Apex R1: 3 empowered spenders + next filler instant
  s.applyAura('player', 'ascendant_stars', { stacks: 3 })
  s.applyAura('player', 'ascendant_fires')
  // Apex R3: Lunar Bolts — 3 bolts, always crit
  for (let i = 0; i < 3; i++) {
    s.schedule(s.time + 0.5 + i * 0.2, () => s.damage('Lunar Bolt', 1.0 * s.stats.critMult))
  }
}

export const balanceDruid: SpecConfig = {
  name: 'Balance Druid',
  specId: 'druid-balance',
  specIcon: 'spell_nature_starfall',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/druid/balance/rotation-cooldowns-pve-dps',
    buildName: 'Elune\'s Chosen Raid Single-Target (Lunar Calling)',
    heroTalent: 'Elune\'s Chosen',
    // Icy Veins "Single-Target (Elune's Chosen - Raid)" export string
    talentString: 'CYGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWoMbNjxMD8AmFzMzMLMMMmZZGGzYhlZWmZMmZDDAGbLzMYMbDgJAAAALMzMzgNjZMmBAwMDWGA',
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
    { id: 'lunar_eclipse', name: 'Lunar Eclipse', icon: 'ability_druid_eclipse', duration: 15 },
    { id: 'incarnation', name: 'Incarnation: Chosen of Elune', icon: 'spell_druid_incarnation', duration: 20 },
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
    {
      id: 'convoke', name: 'Convoke the Spirits', icon: 'inv_ability_druid_convokethespirits', duration: 4,
      tick: { interval: 0.25, hasted: false, onTick: s => s.damage('convoke', CONVOKE_TICK) },
    },
  ],

  abilities: [
    {
      id: 'starfire',
      name: 'Starfire',
      icon: 'spell_arcane_starfire',
      spellId: 194153,
      castTime: 2.25,
      castTimeMod: (s, base) => (s.auraRemains('player', 'ascendant_fires') > 0 ? 0 : base),
      onResolve: (s) => {
        if (s.auraRemains('player', 'ascendant_fires') > 0) s.removeAura('player', 'ascendant_fires')
        s.gain(8, 'starfire')
        const mult = LUNAR_CALLING_MULT * (eclipseUp(s) ? ECLIPSE_FILLER_MULT : 1)
        s.damage('starfire', 1.218 * mult)
        if (s.rng('touch_the_cosmos') < 0.15) s.applyAura('player', 'touch_the_cosmos')
      },
    },
    {
      id: 'wrath',
      name: 'Wrath',
      icon: 'spell_nature_wrathv2',
      spellId: 190984,
      castTime: 1.5,
      onResolve: (s) => {
        s.gain(6, 'wrath') // APPROX: tooltip hides the value
        s.damage('wrath', 1.464)
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
      id: 'incarnation',
      name: 'Incarnation: Chosen of Elune',
      icon: 'spell_druid_incarnation',
      spellId: 102560,
      cooldown: 120, // Whirling Stars
      charges: 2,
      onResolve: (s) => {
        s.applyAura('player', 'incarnation')
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
    'starfire', 'wrath', 'starsurge', 'starfall', 'moonfire', 'sunfire',
    'eclipse', 'incarnation', 'convoke', 'fury_of_elune',
  ],

  damageMult: (s) => {
    let m = 1.10 // Moonkin Form +10% spell damage (always in form)
    if (s.auraRemains('player', 'incarnation') > 0) m *= 1.10
    // S2 4pc: +10% in Eclipse, waning to +2% at the midpoint and back
    const ecl = s.aura('player', 'lunar_eclipse') ?? s.aura('player', 'incarnation')
    if (ecl) {
      const total = ecl.expiresAt - ecl.appliedAt
      const p = Math.max(0, Math.min(1, (s.time - ecl.appliedAt) / total))
      m *= 1 + 0.02 + 0.08 * Math.abs(2 * p - 1)
    }
    return m
  },
  hasteMod: (s) =>
    (s.auraRemains('player', 'incarnation') > 0 ? 0.10 : 0) + 0.02 * s.stacks('player', 'starlord'),

  glows: (s, id) => {
    switch (id) {
      case 'starsurge': return s.auraRemains('player', 'starweavers_weft') > 0 || s.auraRemains('player', 'touch_the_cosmos') > 0
      case 'starfall': return s.auraRemains('player', 'starweavers_warp') > 0
      case 'starfire': return s.auraRemains('player', 'ascendant_fires') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'sunfire', text: 'Keep up — refresh in pandemic (<5.4s), ideally outside Eclipse' },
    { abilityId: 'moonfire', text: 'Keep up — refresh in pandemic (<5.4s), ideally outside Eclipse' },
    { abilityId: 'fury_of_elune', text: 'On cooldown — ~40 Astral Power into the window; align with Eclipse when possible', when: s => s.cooldownRemains('fury_of_elune') === 0 },
    { abilityId: 'incarnation', text: 'On cooldown, entered with high Astral Power (spend Ascendant Stars fast)', when: s => s.cooldownRemains('incarnation') === 0 },
    { abilityId: 'convoke', text: 'Inside Incarnation while under 40 AP', when: s => s.cooldownRemains('convoke') === 0 },
    { abilityId: 'eclipse', text: 'On cooldown with high AP — never sit at 2 charges, never while one is active', when: s => s.cooldownRemains('eclipse') === 0 },
    { abilityId: 'starfall', text: 'Free proc (Starweaver’s Warp) — cast even on single target', when: s => s.auraRemains('player', 'starweavers_warp') > 0 },
    { abilityId: 'starsurge', text: 'Spend in Eclipse (immediately on entry); consume free procs; never cap Astral Power (spend above ~98)' },
    { abilityId: 'starfire', text: 'Filler (Lunar Calling) — always be casting' },
  ],

  policy: (s) => {
    // never clip an in-progress Convoke
    if (s.casting?.channel && s.casting.abilityId === 'convoke') return null
    const ecl = eclipseUp(s)
    const sfRemains = s.auraRemains('target', 'sunfire_dot')
    const mfRemains = s.auraRemains('target', 'moonfire_dot')

    if (sfRemains < 2 || (sfRemains < 5.4 && !ecl)) return 'sunfire'
    if (mfRemains < 2 || (mfRemains < 5.4 && !ecl)) return 'moonfire'
    if (s.cooldownRemains('fury_of_elune') === 0) return 'fury_of_elune'
    if (s.isUsable('incarnation') === true && s.timeToUsable('incarnation') === 0 && s.insanity >= 80) return 'incarnation'
    if (s.auraRemains('player', 'incarnation') > 0 && s.insanity < 40
      && s.isUsable('convoke') === true && s.timeToUsable('convoke') === 0) return 'convoke'
    if (s.isUsable('eclipse') === true && s.timeToUsable('eclipse') === 0
      && (s.chargesOf('eclipse') === 2 || s.insanity >= 60)) return 'eclipse'
    if (s.auraRemains('player', 'starweavers_warp') > 0) return 'starfall'
    if (s.auraRemains('player', 'touch_the_cosmos') > 0 || s.auraRemains('player', 'starweavers_weft') > 0) return 'starsurge'
    if (ecl && s.insanity >= 40) return 'starsurge'
    if (!ecl && s.insanity > 98) return 'starsurge' // anti-overcap (Maxroll: spend above ~82/100)
    return 'starfire'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const dots = ['moonfire', 'sunfire']
    const spenders = ['starsurge', 'starfall']
    const fillers = ['starfire', 'wrath']
    const sets = [dots, spenders, fillers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
