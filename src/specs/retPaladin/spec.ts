import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Retribution Paladin — patch 12.1.0 (Midnight, Season 2), Templar raid
 * single-target build with Crusading Strikes. Verified against live guides
 * 2026-08-24:
 *   - Wowhead rotation guide: https://www.wowhead.com/guide/classes/paladin/retribution/rotation-cooldowns-pve-dps
 *   - Method playstyle/rotation (Templar ST list): https://www.method.gg/guides/retribution-paladin/playstyle-and-rotation
 *   - Icy Veins rotation: https://www.icy-veins.com/wow/retribution-paladin-pve-dps-rotation-cooldowns-abilities
 *   - Icy Veins builds (raid ST import string): https://www.icy-veins.com/wow/retribution-paladin-pve-dps-spec-builds-talents
 *
 * Resource model: Holy Power (max 5). Generators: Crusading Strikes (every
 * 2nd auto grants 1 — Crusader Strike is off the bar with this talent),
 * Blade of Justice (+2, applies Expurgation), Judgment (+1, debuffs the
 * target so the next spender hits harder), Wake of Ashes (+3, makes Hammer
 * of Light castable), Divine Toll (ST: one Judgment, +1), Hammer of Wrath
 * (+1, castable only during Avenging Wrath here — the dummy never dips
 * below 20% health). Spenders (3 HP): Final Verdict; Hammer of Light
 * (12.1 change: costs 3, damage -30%); Execution Sentence banks 20% of all
 * damage dealt during its 8s window, then detonates; Divine Storm only with
 * an Empyrean Power proc (free) on single target.
 * Talent assumptions (Icy Veins/Method Templar raid build): Crusading
 * Strikes, Art of War + apex Light Within (procs bank 2 charges, Blade of
 * Justice +80% with a charge — dump at 2 to avoid wasting procs), Truth's
 * Wake (Wake of Ashes also applies Expurgation), Quickened Invocation
 * (Divine Toll 45s), Empyrean Power, Divine Purpose.
 * S2 tier: 2pc Divine Purpose +10% proc chance, consuming it grants Divine
 * Power (+10% Holy for 12s); 4pc consuming Divine Purpose grants Divine
 * Arbiter — the next spender unleashes an extra arbiter hit. Per both
 * guides, Templar does NOT spend Divine Arbiter actively on ST (no Divine
 * Storm weaving) — it is consumed passively by the normal spender flow.
 * Unmodeled: Light's Deliverance free Hammer of Light (60-HP counter),
 * execute-range Hammer of Wrath. APPROX-flagged: auto cadence, proc rates,
 * Expurgation duration, all coefficients (AP units, relative magnitudes).
 */

const AUTO_COEFF = 0.25
const SWING_TIME = 2.0
const AOW_CHANCE = 0.25       // APPROX: Art of War per swing
const BOJ_COEFF = 1.1
const AOW_BOJ_MULT = 1.8      // apex Light Within R1: +80% with Art of War
const EXPURGATION_TICK = 0.15 // APPROX: 12.1 duration/coefficient unpublished
const JUDGMENT_COEFF = 1.0
const JUDGMENT_AMP = 1.25     // APPROX: debuff amp on the next spender
const HOW_COEFF = 1.0
const WAKE_COEFF = 2.2
const HOL_COEFF = 3.0         // incl. the 12.1 -30% (still the hardest hit)
const FV_COEFF = 2.0
const DS_COEFF = 1.25         // incl. Empyrean Power bonus
const ES_HIT = 0.8
const ES_PCT = 0.20
const AW_AMP = 1.20
const DP_CHANCE = 0.25        // 15% Divine Purpose + 10% S2 2pc, APPROX
const DP_AMP = 1.10           // Divine Purpose spender bonus
const DIVINE_POWER_AMP = 1.10 // S2 2pc buff
const ARBITER_COEFF = 1.4     // S2 4pc, APPROX vs 405% AP tooltip
const EP_CHANCE = 0.12        // APPROX: Empyrean Power per Crusading Strike

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
 * Shared Holy Power spender flow: Judgment debuff amp, Divine Purpose
 * consume (S2 2pc Divine Power + 4pc Divine Arbiter) and re-proc, pending
 * Divine Arbiter hit from a previous consume.
 */
function spenderHit(s: SimAPI, id: string, coeff: number) {
  const dpActive = s.auraRemains('player', 'divine_purpose') > 0
  let mult = 1
  if (dpActive) mult *= DP_AMP
  if (s.auraRemains('target', 'judgment') > 0) {
    s.removeAura('target', 'judgment')
    mult *= JUDGMENT_AMP
  }
  retDamage(s, id, coeff * mult)
  // S2 4pc: an earlier Divine Purpose consume armed an arbiter of light
  if (s.auraRemains('player', 'divine_arbiter') > 0) {
    s.removeAura('player', 'divine_arbiter')
    retDamage(s, 'Divine Arbiter', ARBITER_COEFF)
  }
  if (dpActive) {
    s.removeAura('player', 'divine_purpose')
    s.applyAura('player', 'divine_power')   // S2 2pc: +10% Holy for 12s
    s.applyAura('player', 'divine_arbiter') // S2 4pc: arm the next spender
  }
  if (s.rng('divine_purpose') < DP_CHANCE) s.applyAura('player', 'divine_purpose')
}

/** free spender when Divine Purpose is up (S2 tier revolves around this) */
function dpCost(s: SimAPI): number {
  return s.auraRemains('player', 'divine_purpose') > 0 ? 0 : 3
}

export const retPaladin: SpecConfig = {
  name: 'Retribution Paladin',
  specId: 'paladin-retribution',
  specIcon: 'spell_holy_auraoflight',
  resourceName: 'Holy Power',
  resourceMax: 5,
  startingResource: 0,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/paladin/retribution/rotation-cooldowns-pve-dps',
    buildName: 'Templar Raid ST (Crusading Strikes)',
    heroTalent: 'Templar',
    talentString: 'CYEAAAAAAAAAAAAAAAAAAAAAAAAAAAANbbzMzywMDAAAAAAzUGzwMjtxsNMz2MGjZGmxCbDAAgZm2mZ2mBAsBYAwYGmBzYMbYbGMMmxgB',
    retrieved: '2026-08-24',
  },

  onCombatStart: (s) => {
    const swing = () => {
      retDamage(s, 'Auto Attack', AUTO_COEFF)
      // Crusading Strikes: every 2nd auto attack generates 1 Holy Power
      s.data.cs_swing = (s.data.cs_swing ?? 0) + 1
      if (s.data.cs_swing % 2 === 0) {
        s.gain(1, 'crusading_strikes')
        // Empyrean Power: Crusading Strikes can grant a free Divine Storm
        if (s.rng('empyrean_power') < EP_CHANCE) s.applyAura('player', 'empyrean_power')
      }
      // Art of War (apex Light Within): banks up to 2 Blade of Justice resets
      if (s.rng('art_of_war') < AOW_CHANCE) s.applyAura('player', 'art_of_war', { stacks: 1 })
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
    { id: 'avenging_wrath', name: 'Avenging Wrath', icon: 'spell_holy_avenginewrath', duration: 20 },
    { id: 'art_of_war', name: 'Art of War', icon: 'ability_paladin_artofwar', duration: 15, maxStacks: 2 },
    { id: 'hammer_of_light_ready', name: 'Hammer of Light', icon: 'spell_paladin_lightshammer', duration: 12 },
    { id: 'empyrean_power', name: 'Empyrean Power', icon: 'ability_paladin_sheathoflight', duration: 15 },
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
      // Art of War charge: this press doesn't touch the cooldown
      noCooldownIf: (s) => s.stacks('player', 'art_of_war') > 0,
      onResolve: (s) => {
        let mult = 1
        if (s.stacks('player', 'art_of_war') > 0) {
          s.consumeStack('player', 'art_of_war')
          mult = AOW_BOJ_MULT // Light Within: +80% with Art of War
        }
        retDamage(s, 'blade_of_justice', BOJ_COEFF * mult)
        s.applyAura('target', 'expurgation')
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
        s.applyAura('target', 'expurgation') // Truth's Wake
        s.applyAura('player', 'hammer_of_light_ready') // Templar
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
      id: 'hammer_of_light',
      name: 'Hammer of Light',
      icon: 'spell_paladin_lightshammer',
      spellId: 427453,
      cost: 3, // 12.1: down from 5
      costMod: dpCost,
      usable: (s) => s.auraRemains('player', 'hammer_of_light_ready') > 0
        || 'requires Wake of Ashes first',
      onResolve: (s) => {
        s.removeAura('player', 'hammer_of_light_ready')
        spenderHit(s, 'hammer_of_light', HOL_COEFF)
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
      costMod: (s) => (s.auraRemains('player', 'empyrean_power') > 0 ? 0 : dpCost(s)),
      usable: (s) => s.auraRemains('player', 'empyrean_power') > 0
        || 'single target: only with Empyrean Power',
      onResolve: (s) => {
        s.removeAura('player', 'empyrean_power')
        spenderHit(s, 'divine_storm', DS_COEFF)
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
      onResolve: (s) => s.applyAura('player', 'avenging_wrath'),
    },
  ],

  actionBar: [
    'blade_of_justice', 'judgment', 'hammer_of_wrath', 'wake_of_ashes',
    'divine_toll', 'hammer_of_light', 'final_verdict', 'divine_storm',
    'execution_sentence', 'avenging_wrath',
  ],

  damageMult: (s) => {
    let mult = 1
    if (s.auraRemains('player', 'avenging_wrath') > 0) mult *= AW_AMP
    if (s.auraRemains('player', 'divine_power') > 0) mult *= DIVINE_POWER_AMP // S2 2pc
    return mult
  },

  glows: (s, id) => {
    switch (id) {
      case 'final_verdict':
        return s.insanity === 5 || s.auraRemains('player', 'divine_purpose') > 0
      case 'hammer_of_light':
        return s.auraRemains('player', 'hammer_of_light_ready') > 0
          && (s.insanity >= 3 || s.auraRemains('player', 'divine_purpose') > 0)
      case 'divine_storm':
        return s.auraRemains('player', 'empyrean_power') > 0
      case 'blade_of_justice':
        return s.stacks('player', 'art_of_war') === 2
      case 'wake_of_ashes':
        return s.cooldownRemains('wake_of_ashes') === 0
      case 'execution_sentence':
        return s.cooldownRemains('execution_sentence') === 0 && s.insanity >= 3
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'avenging_wrath', text: 'Off-GCD, on cooldown (pair with Execution Sentence)', when: s => s.cooldownRemains('avenging_wrath') === 0 },
    { abilityId: 'execution_sentence', text: 'On cooldown with 3+ HP — then pump damage into its window', when: s => s.cooldownRemains('execution_sentence') === 0 && (s.insanity >= 3 || s.auraRemains('player', 'divine_purpose') > 0) },
    { abilityId: 'hammer_of_light', text: 'After Wake of Ashes, at 3+ HP — the hardest hit in the kit', when: s => s.auraRemains('player', 'hammer_of_light_ready') > 0 && (s.insanity >= 3 || s.auraRemains('player', 'divine_purpose') > 0) },
    { abilityId: 'final_verdict', text: 'At 5 HP, or free with Divine Purpose — never cap', when: s => s.insanity === 5 || s.auraRemains('player', 'divine_purpose') > 0 },
    { abilityId: 'wake_of_ashes', text: 'On cooldown — never sit on it (unlocks Hammer of Light)', when: s => s.cooldownRemains('wake_of_ashes') === 0 },
    { abilityId: 'divine_toll', text: 'On cooldown at ≤4 HP', when: s => s.cooldownRemains('divine_toll') === 0 && s.insanity <= 4 },
    { abilityId: 'blade_of_justice', text: 'At 2 Art of War charges, even at 4 HP — a 3rd proc would be wasted', when: s => s.stacks('player', 'art_of_war') === 2 && s.insanity <= 4 },
    { abilityId: 'final_verdict', text: 'At 4+ HP', when: s => s.insanity >= 4 },
    { abilityId: 'blade_of_justice', text: 'On cooldown (or with an Art of War charge) at ≤3 HP', when: s => (s.cooldownRemains('blade_of_justice') === 0 || s.stacks('player', 'art_of_war') > 0) && s.insanity <= 3 },
    { abilityId: 'hammer_of_wrath', text: 'During Avenging Wrath at ≤4 HP', when: s => s.cooldownRemains('hammer_of_wrath') === 0 && s.auraRemains('player', 'avenging_wrath') > 0 && s.insanity <= 4 },
    { abilityId: 'judgment', text: 'On cooldown at ≤4 HP (keep the debuff feeding spenders)', when: s => s.cooldownRemains('judgment') === 0 && s.insanity <= 4 },
    { abilityId: 'divine_storm', text: 'With an Empyrean Power proc (free)', when: s => s.auraRemains('player', 'empyrean_power') > 0 },
    { abilityId: 'final_verdict', text: 'Spend at 3+ HP when nothing else is up' },
  ],

  policy: (s) => {
    const hp = s.insanity
    const dp = s.auraRemains('player', 'divine_purpose') > 0

    if (s.cooldownRemains('avenging_wrath') === 0) return 'avenging_wrath'
    if (s.cooldownRemains('execution_sentence') === 0 && (hp >= 3 || dp)) return 'execution_sentence'
    if (s.auraRemains('player', 'hammer_of_light_ready') > 0 && (hp >= 3 || dp)) return 'hammer_of_light'
    if (hp === 5 || dp) return 'final_verdict'
    if (s.cooldownRemains('wake_of_ashes') === 0) return 'wake_of_ashes'
    if (s.cooldownRemains('divine_toll') === 0 && hp <= 4) return 'divine_toll'
    if (s.stacks('player', 'art_of_war') === 2 && hp <= 4) return 'blade_of_justice'
    if (hp >= 4) return 'final_verdict'
    if ((s.cooldownRemains('blade_of_justice') === 0 || s.stacks('player', 'art_of_war') > 0) && hp <= 3) return 'blade_of_justice'
    if (s.cooldownRemains('hammer_of_wrath') === 0 && s.auraRemains('player', 'avenging_wrath') > 0 && hp <= 4) return 'hammer_of_wrath'
    if (s.cooldownRemains('judgment') === 0 && hp <= 4) return 'judgment'
    if (s.auraRemains('player', 'empyrean_power') > 0) return 'divine_storm'
    if (hp >= 3) return 'final_verdict'
    return null
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['blade_of_justice', 'judgment', 'hammer_of_wrath', 'divine_toll']
    const spenders = ['final_verdict', 'execution_sentence', 'hammer_of_light', 'divine_storm']
    const sets = [builders, spenders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
