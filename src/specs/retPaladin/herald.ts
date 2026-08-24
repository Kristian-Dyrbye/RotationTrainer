import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Retribution Paladin — patch 12.1.0 (Midnight, Season 2), Herald of the
 * Sun raid single-target build (alternate build; default spec.ts =
 * Templar). Verified against live guides 2026-08-24:
 *   - Wowhead rotation guide: https://www.wowhead.com/guide/classes/paladin/retribution/rotation-cooldowns-pve-dps
 *   - Method playstyle/rotation ("Herald of the Sun Single Target
 *     Priority" — the priority modeled here, row for row):
 *     https://www.method.gg/guides/retribution-paladin/playstyle-and-rotation
 *   - Method talents ("Herald of the Sun Single Target (Raid)" build +
 *     import string): https://www.method.gg/guides/retribution-paladin/talents
 *   - Icy Veins rotation (S2 tier note: Divine Arbiter procs ARE worth
 *     spending actively on ST for Herald, via Divine Storm):
 *     https://www.icy-veins.com/wow/retribution-paladin-pve-dps-rotation-cooldowns-abilities
 *
 * Herald of the Sun vs the default Templar build: NO Hammer of Light —
 * Wake of Ashes instead causes the next 3 Holy Power spenders to apply
 * Dawnlight (8s radiant DoT). While a Dawnlight is active, spenders deal
 * +5% (Gleaming Rays), and every Dawnlight application grants stacking
 * haste (Solar Grace). Activating Avenging Wrath applies a Dawnlight and
 * starts Sun's Avatar: beams link you to Dawnlight targets, dealing damage
 * while both are up. Aurora grants Divine Purpose after every Wake of
 * Ashes. Hammer of Wrath hits harder (Walk Into Light) and, like Divine
 * Storm, can echo at partial effect (Second Sunrise).
 * S2 tier (same 2pc/4pc as spec.ts): 2pc Divine Purpose +10% proc chance,
 * consuming it grants Divine Power (+10% Holy for 12s); 4pc consuming
 * Divine Purpose arms Divine Arbiter. THE Herald-defining difference per
 * Method/Icy Veins: on single target, Divine Arbiter is spent ACTIVELY by
 * weaving Divine Storm after the Final Verdict that consumed Divine
 * Purpose (Templar lets the next spender eat it passively instead).
 * Shared mechanics reused from spec.ts: Holy Power model, Crusading
 * Strikes (every 2nd auto grants 1 HP — Crusader Strike is off the bar),
 * Art of War Blade of Justice resets, Expurgation via Blade of
 * Justice/Truth's Wake, Judgment debuff amp, Execution Sentence 20% bank,
 * Divine Toll (45s, ST: one bonus Judgment), Hammer of Wrath gated behind
 * Avenging Wrath (the dummy never dips below 20%).
 * Unmodeled: Radiant Glory variant (this build runs real Avenging Wrath,
 * Method row 1), "Final Verdict at 4 HP if an auto is imminent" timing
 * nuance, Templar Strikes rows (not talented), Sun Sear, Morning Star
 * stacking, execute-range Hammer of Wrath. APPROX-flagged: auto cadence,
 * proc rates (Art of War, Divine Purpose, Second Sunrise), Solar Grace
 * cap, Dawnlight/Sun's Avatar tick sizes, Expurgation duration, all
 * coefficients (AP units, relative magnitudes only). Light Within's
 * 2-charge Art of War banking is treated as Templar-only here (single
 * charge, no +80% Blade of Justice).
 */

const AUTO_COEFF = 0.25
const SWING_TIME = 2.0
const AOW_CHANCE = 0.25         // APPROX: Art of War per swing
const BOJ_COEFF = 1.1
const EXPURGATION_TICK = 0.15   // APPROX: 12.1 duration/coefficient unpublished
const JUDGMENT_COEFF = 1.0
const JUDGMENT_AMP = 1.25       // APPROX: debuff amp on the next spender
const HOW_COEFF = 1.3           // Walk Into Light folded in, APPROX
const WAKE_COEFF = 2.2
const FV_COEFF = 2.0
const DS_COEFF = 1.4            // Herald-buffed Divine Storm on ST, APPROX
const ES_HIT = 0.8
const ES_PCT = 0.20
const AW_AMP = 1.20
const DP_CHANCE = 0.25          // 15% Divine Purpose + 10% S2 2pc, APPROX
const DP_AMP = 1.10             // Divine Purpose spender bonus
const DIVINE_POWER_AMP = 1.10   // S2 2pc buff
const ARBITER_COEFF = 1.4       // S2 4pc, APPROX vs 405% AP tooltip
const DAWNLIGHT_TICK = 0.30     // APPROX: 8s radiant DoT
const SUNS_AVATAR_TICK = 0.25   // APPROX: beam while AW + Dawnlight overlap
const GLEAMING_RAYS = 1.05      // spenders +5% while a Dawnlight is active
const SOLAR_GRACE_HASTE = 0.02  // haste per stack, per Dawnlight applied
const SECOND_SUNRISE_CHANCE = 0.15 // APPROX: HoW/DS echo chance
const SECOND_SUNRISE_MULT = 0.30   // echo at 30% effect

/**
 * All damage funnels through here so Execution Sentence can bank 20% of
 * everything dealt inside its window (expected-value, APPROX).
 */
function retDamage(s: SimAPI, id: string, coeff: number, opts?: { canCrit?: boolean }) {
  s.damage(id, coeff, { ...opts, tags: ['holy'] })
  const es = s.aura('target', 'execution_sentence')
  if (es) {
    const canCrit = opts?.canCrit ?? true
    const expected = canCrit ? coeff * (1 + s.stats.critChance * (s.stats.critMult - 1)) : coeff
    es.data.bank = (es.data.bank ?? 0) + expected
  }
}

/**
 * Refresh a ticking DoT by re-applying it with the pandemic duration
 * computed by hand. The engine stops a DoT's tick chain once the next tick
 * would land past the current expiry, and a plain refresh never restarts
 * it — re-applying fresh keeps Expurgation/Dawnlight actually ticking
 * (uptime accounting stays continuous).
 */
function applyDot(s: SimAPI, id: string, dur: number) {
  const rem = s.auraRemains('target', id)
  if (rem > 0) {
    s.removeAura('target', id)
    s.applyAura('target', id, { duration: dur + Math.min(rem, 0.3 * dur) })
  } else {
    s.applyAura('target', id)
  }
}

/** put a Dawnlight on the target: radiant DoT + Solar Grace haste stack */
function applyDawnlight(s: SimAPI) {
  applyDot(s, 'dawnlight', 8)
  s.applyAura('player', 'solar_grace', { stacks: 1 })
}

/**
 * Shared Holy Power spender flow: pending Wake of Ashes Dawnlight charge,
 * Gleaming Rays, Judgment debuff amp, Divine Purpose consume (S2 2pc
 * Divine Power + 4pc arming Divine Arbiter) and re-proc. Unlike spec.ts,
 * the armed Divine Arbiter is NOT unleashed here — Herald spends it
 * actively by casting Divine Storm.
 */
function spenderHit(s: SimAPI, id: string, coeff: number) {
  if (s.stacks('player', 'dawnlight_charges') > 0) {
    s.consumeStack('player', 'dawnlight_charges')
    applyDawnlight(s)
  }
  const dpActive = s.auraRemains('player', 'divine_purpose') > 0
  let mult = 1
  if (dpActive) mult *= DP_AMP
  if (s.auraRemains('target', 'dawnlight') > 0) mult *= GLEAMING_RAYS
  if (s.auraRemains('target', 'judgment') > 0) {
    s.removeAura('target', 'judgment')
    mult *= JUDGMENT_AMP
  }
  retDamage(s, id, coeff * mult)
  if (dpActive) {
    s.removeAura('player', 'divine_purpose')
    s.applyAura('player', 'divine_power')   // S2 2pc: +10% Holy for 12s
    s.applyAura('player', 'divine_arbiter') // S2 4pc: arm — spend via Divine Storm
  }
  if (s.rng('divine_purpose') < DP_CHANCE) s.applyAura('player', 'divine_purpose')
}

/** free spender when Divine Purpose is up (S2 tier revolves around this) */
function dpCost(s: SimAPI): number {
  return s.auraRemains('player', 'divine_purpose') > 0 ? 0 : 3
}

export const retHerald: SpecConfig = {
  name: 'Retribution Paladin',
  specId: 'paladin-retribution',
  specIcon: 'spell_holy_auraoflight',
  buildId: 'herald-of-the-sun',
  resourceName: 'Holy Power',
  resourceMax: 5,
  startingResource: 0,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/paladin/retribution/rotation-cooldowns-pve-dps',
    buildName: 'Herald of the Sun Raid ST (Crusading Strikes)',
    heroTalent: 'Herald of the Sun',
    // Method "Herald of the Sun Single Target (Raid)" import string,
    // verified byte-exact in the page HTML 2026-08-24
    talentString: 'CYEAAAAAAAAAAAAAAAAAAAAAAAAAAAANbbzMzywMDAAAAAAzUmtZYmx2Y2GmZbGjxYYGLsNAMLz2Mzs1gAAAWAMAYMDDMjZmNgZmhxMGMA',
    retrieved: '2026-08-24',
  },

  onCombatStart: (s) => {
    const swing = () => {
      retDamage(s, 'Auto Attack', AUTO_COEFF)
      // Crusading Strikes: every 2nd auto attack generates 1 Holy Power
      s.data.cs_swing = (s.data.cs_swing ?? 0) + 1
      if (s.data.cs_swing % 2 === 0) s.gain(1, 'crusading_strikes')
      // Art of War: swings can reset Blade of Justice
      if (s.rng('art_of_war') < AOW_CHANCE) s.applyAura('player', 'art_of_war')
      s.schedule(s.time + SWING_TIME * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'judgment', name: 'Judgment', icon: 'spell_holy_righteousfury', duration: 15, debuff: true },
    {
      id: 'expurgation', name: 'Expurgation', icon: 'spell_holy_sealofvengeance',
      duration: 9, pandemic: true, debuff: true, // APPROX duration
      tick: { interval: 3, hasted: true, onTick: s => retDamage(s, 'Expurgation', EXPURGATION_TICK) },
    },
    {
      id: 'dawnlight', name: 'Dawnlight', icon: 'inv_ability_heraldofthesunpaladin_dawnlight',
      duration: 8, pandemic: true, debuff: true, // pandemic APPROX (spenders re-apply back-to-back)
      tick: { interval: 1, hasted: true, onTick: s => retDamage(s, 'Dawnlight', DAWNLIGHT_TICK) },
    },
    {
      // Wake of Ashes: the next 3 Holy Power spenders each apply a Dawnlight
      id: 'dawnlight_charges', name: 'Dawnlight (pending)', icon: 'inv_ability_heraldofthesunpaladin_dawnlight',
      duration: 30, maxStacks: 3,
    },
    {
      // Sun's Avatar: while Avenging Wrath is up, beams link you to
      // Dawnlight targets and burn anything in between
      id: 'suns_avatar', name: "Sun's Avatar", icon: 'spell_priest_divinestar_holy',
      duration: 20,
      tick: {
        interval: 1, hasted: false,
        onTick: (s) => {
          if (s.auraRemains('target', 'dawnlight') > 0) retDamage(s, "Sun's Avatar", SUNS_AVATAR_TICK)
        },
      },
    },
    { id: 'solar_grace', name: 'Solar Grace', icon: 'ability_paladin_veneration', duration: 12, maxStacks: 5 },
    { id: 'avenging_wrath', name: 'Avenging Wrath', icon: 'spell_holy_avenginewrath', duration: 20 },
    { id: 'art_of_war', name: 'Art of War', icon: 'ability_paladin_artofwar', duration: 15 },
    { id: 'divine_purpose', name: 'Divine Purpose', icon: 'spell_holy_divinepurpose', duration: 12 },
    { id: 'divine_power', name: 'Divine Power', icon: 'spell_holy_innerfire', duration: 12 },
    { id: 'divine_arbiter', name: 'Divine Arbiter', icon: 'spell_holy_eyeforaneye', duration: 15 },
    {
      id: 'execution_sentence', name: 'Execution Sentence', icon: 'spell_paladin_executionsentence',
      duration: 8, debuff: true,
      onExpire: (s, aura) => {
        const boom = (aura.data.bank ?? 0) * ES_PCT
        if (boom <= 0) return
        s.damage('Execution Sentence', boom, { canCrit: false, tags: ['holy'] })
      },
    },
  ],

  abilities: [
    {
      id: 'blade_of_justice',
      name: 'Blade of Justice',
      icon: 'ability_paladin_bladeofjustice',
      spellId: 184575,
      cooldown: 12,
      // Art of War proc: this press doesn't touch the cooldown
      noCooldownIf: (s) => s.stacks('player', 'art_of_war') > 0,
      onResolve: (s) => {
        if (s.stacks('player', 'art_of_war') > 0) s.consumeStack('player', 'art_of_war')
        retDamage(s, 'blade_of_justice', BOJ_COEFF)
        applyDot(s, 'expurgation', 9)
        s.gain(2, 'blade_of_justice')
      },
    },
    {
      id: 'judgment',
      name: 'Judgment',
      icon: 'spell_holy_righteousfury',
      spellId: 20271,
      cooldown: 12,
      onResolve: (s) => {
        retDamage(s, 'judgment', JUDGMENT_COEFF)
        s.applyAura('target', 'judgment')
        s.gain(1, 'judgment')
      },
    },
    {
      id: 'hammer_of_wrath',
      name: 'Hammer of Wrath',
      icon: 'spell_paladin_hammerofwrath',
      spellId: 24275,
      cooldown: 7.5,
      usable: (s) => s.auraRemains('player', 'avenging_wrath') > 0
        || 'requires Avenging Wrath (or a target below 20%)',
      onResolve: (s) => {
        retDamage(s, 'hammer_of_wrath', HOW_COEFF)
        // Second Sunrise: chance to strike again at partial effect
        if (s.rng('second_sunrise') < SECOND_SUNRISE_CHANCE) {
          s.schedule(s.time + 0.4, () => retDamage(s, 'Second Sunrise', HOW_COEFF * SECOND_SUNRISE_MULT))
        }
        s.gain(1, 'hammer_of_wrath')
      },
    },
    {
      id: 'wake_of_ashes',
      name: 'Wake of Ashes',
      icon: 'inv_sword_2h_artifactashbringer_d_01',
      spellId: 255937,
      cooldown: 30,
      onResolve: (s) => {
        retDamage(s, 'wake_of_ashes', WAKE_COEFF)
        s.gain(3, 'wake_of_ashes')
        applyDot(s, 'expurgation', 9) // Truth's Wake
        // Herald: the next 3 Holy Power spenders apply a Dawnlight
        s.applyAura('player', 'dawnlight_charges', { stacks: 3 })
        // Aurora: gain Divine Purpose after casting Wake of Ashes
        s.applyAura('player', 'divine_purpose')
      },
    },
    {
      id: 'divine_toll',
      name: 'Divine Toll',
      icon: 'ability_bastion_paladin',
      spellId: 375576,
      cooldown: 45, // incl. Quickened Invocation
      onResolve: (s) => {
        // single target: one bonus Judgment
        retDamage(s, 'divine_toll', JUDGMENT_COEFF)
        s.applyAura('target', 'judgment')
        s.gain(1, 'divine_toll')
      },
    },
    {
      id: 'final_verdict',
      name: 'Final Verdict',
      icon: 'spell_paladin_templarsverdict',
      spellId: 383328,
      cost: 3,
      costMod: dpCost,
      onResolve: (s) => spenderHit(s, 'final_verdict', FV_COEFF),
    },
    {
      id: 'divine_storm',
      name: 'Divine Storm',
      icon: 'ability_paladin_divinestorm',
      spellId: 53385,
      cost: 3,
      costMod: dpCost,
      usable: (s) => s.auraRemains('player', 'divine_arbiter') > 0
        || 'single target: only to spend a Divine Arbiter proc',
      onResolve: (s) => {
        // capture before spenderHit so a DP consume in it can't be double-spent
        const armed = s.auraRemains('player', 'divine_arbiter') > 0
        spenderHit(s, 'divine_storm', DS_COEFF)
        if (armed) {
          s.removeAura('player', 'divine_arbiter')
          retDamage(s, 'Divine Arbiter', ARBITER_COEFF)
        }
        // Second Sunrise: chance to storm again at partial effect
        if (s.rng('second_sunrise') < SECOND_SUNRISE_CHANCE) {
          s.schedule(s.time + 0.4, () => retDamage(s, 'Second Sunrise', DS_COEFF * SECOND_SUNRISE_MULT))
        }
      },
    },
    {
      id: 'execution_sentence',
      name: 'Execution Sentence',
      icon: 'spell_paladin_executionsentence',
      spellId: 343527,
      cost: 3,
      costMod: dpCost,
      cooldown: 60,
      onResolve: (s) => {
        spenderHit(s, 'execution_sentence', ES_HIT)
        s.applyAura('target', 'execution_sentence')
      },
    },
    {
      id: 'avenging_wrath',
      name: 'Avenging Wrath',
      icon: 'spell_holy_avenginewrath',
      spellId: 31884,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => {
        s.applyAura('player', 'avenging_wrath')
        // Sun's Avatar: activating AW applies a Dawnlight and links beams
        applyDawnlight(s)
        s.applyAura('player', 'suns_avatar')
      },
    },
  ],

  actionBar: [
    'blade_of_justice', 'judgment', 'hammer_of_wrath', 'wake_of_ashes',
    'divine_toll', 'final_verdict', 'divine_storm', 'execution_sentence',
    'avenging_wrath',
  ],

  damageMult: (s) => {
    let mult = 1
    if (s.auraRemains('player', 'avenging_wrath') > 0) mult *= AW_AMP
    if (s.auraRemains('player', 'divine_power') > 0) mult *= DIVINE_POWER_AMP // S2 2pc
    return mult
  },

  // Solar Grace: each Dawnlight applied grants stacking haste
  hasteMod: (s) => s.stacks('player', 'solar_grace') * SOLAR_GRACE_HASTE,

  glows: (s, id) => {
    switch (id) {
      case 'divine_storm':
        return s.auraRemains('player', 'divine_arbiter') > 0
          && (s.insanity >= 3 || s.auraRemains('player', 'divine_purpose') > 0)
      case 'final_verdict':
        return s.insanity === 5 || s.auraRemains('player', 'divine_purpose') > 0
      case 'blade_of_justice':
        return s.stacks('player', 'art_of_war') > 0
      case 'wake_of_ashes':
        return s.cooldownRemains('wake_of_ashes') === 0
      case 'execution_sentence':
        return s.cooldownRemains('execution_sentence') === 0 && s.insanity >= 3
      default: return false
    }
  },

  // Method "Herald of the Sun Single Target Priority", row for row
  priorityList: [
    { abilityId: 'avenging_wrath', text: 'Off-GCD, on cooldown (starts Sun\'s Avatar + a Dawnlight)', when: s => s.cooldownRemains('avenging_wrath') === 0 },
    { abilityId: 'execution_sentence', text: 'On cooldown with 3+ HP — then pump damage into its window', when: s => s.cooldownRemains('execution_sentence') === 0 && (s.insanity >= 3 || s.auraRemains('player', 'divine_purpose') > 0) },
    { abilityId: 'divine_storm', text: 'With a Divine Arbiter proc at 5 HP (S2 4pc — spend it actively)', when: s => s.auraRemains('player', 'divine_arbiter') > 0 && (s.insanity === 5 || s.auraRemains('player', 'divine_purpose') > 0) },
    { abilityId: 'final_verdict', text: 'At 5 HP, or free with Divine Purpose — never cap', when: s => s.insanity === 5 || s.auraRemains('player', 'divine_purpose') > 0 },
    { abilityId: 'wake_of_ashes', text: 'On cooldown — 3 HP, 3 Dawnlights, and Divine Purpose (Aurora)', when: s => s.cooldownRemains('wake_of_ashes') === 0 },
    { abilityId: 'divine_toll', text: 'On cooldown at ≤4 HP', when: s => s.cooldownRemains('divine_toll') === 0 && s.insanity <= 4 },
    { abilityId: 'blade_of_justice', text: 'With an Art of War proc while Avenging Wrath is down, at ≤3 HP', when: s => s.stacks('player', 'art_of_war') > 0 && s.auraRemains('player', 'avenging_wrath') === 0 && s.insanity <= 3 },
    { abilityId: 'divine_storm', text: 'With a Divine Arbiter proc at 3+ HP', when: s => s.auraRemains('player', 'divine_arbiter') > 0 && (s.insanity >= 3 || s.auraRemains('player', 'divine_purpose') > 0) },
    { abilityId: 'final_verdict', text: 'At 4+ HP', when: s => s.insanity >= 4 },
    { abilityId: 'hammer_of_wrath', text: 'During Avenging Wrath at ≤4 HP (Walk Into Light)', when: s => s.cooldownRemains('hammer_of_wrath') === 0 && s.auraRemains('player', 'avenging_wrath') > 0 && s.insanity <= 4 },
    { abilityId: 'blade_of_justice', text: 'On cooldown (or with an Art of War proc) at ≤3 HP', when: s => (s.cooldownRemains('blade_of_justice') === 0 || s.stacks('player', 'art_of_war') > 0) && s.insanity <= 3 },
    { abilityId: 'judgment', text: 'On cooldown at ≤4 HP (keep the debuff feeding spenders)', when: s => s.cooldownRemains('judgment') === 0 && s.insanity <= 4 },
    { abilityId: 'final_verdict', text: 'Spend at 3+ HP when nothing else is up' },
  ],

  policy: (s) => {
    const hp = s.insanity
    const dp = s.auraRemains('player', 'divine_purpose') > 0
    const arb = s.auraRemains('player', 'divine_arbiter') > 0
    const aw = s.auraRemains('player', 'avenging_wrath') > 0

    if (s.cooldownRemains('avenging_wrath') === 0) return 'avenging_wrath'
    if (s.cooldownRemains('execution_sentence') === 0 && (hp >= 3 || dp)) return 'execution_sentence'
    if (arb && (hp === 5 || dp)) return 'divine_storm'
    if (hp === 5 || dp) return 'final_verdict'
    if (s.cooldownRemains('wake_of_ashes') === 0) return 'wake_of_ashes'
    if (s.cooldownRemains('divine_toll') === 0 && hp <= 4) return 'divine_toll'
    if (s.stacks('player', 'art_of_war') > 0 && !aw && hp <= 3) return 'blade_of_justice'
    if (arb && hp >= 3) return 'divine_storm'
    if (hp >= 4) return 'final_verdict'
    if (s.cooldownRemains('hammer_of_wrath') === 0 && aw && hp <= 4) return 'hammer_of_wrath'
    if ((s.cooldownRemains('blade_of_justice') === 0 || s.stacks('player', 'art_of_war') > 0) && hp <= 3) return 'blade_of_justice'
    if (s.cooldownRemains('judgment') === 0 && hp <= 4) return 'judgment'
    if (hp >= 3) return 'final_verdict'
    return null
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['blade_of_justice', 'judgment', 'hammer_of_wrath', 'divine_toll']
    const spenders = ['final_verdict', 'execution_sentence', 'divine_storm']
    const sets = [builders, spenders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
