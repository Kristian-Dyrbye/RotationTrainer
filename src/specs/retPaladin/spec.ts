import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Retribution Paladin — patch 12.1.0 (Midnight, Season 2), Herald of the Sun
 * raid ST build (Icy Veins default). Built from the simc `midnight`
 * APL/source and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Holy Power (max 5). Generators: Blade of Justice (+2),
 * Judgment (+1, debuffs the target so the next spender hits +35%),
 * Crusader Strike (+1, 2 charges), Wake of Ashes (+3, applies Dawnlight).
 * Spenders (3 HP): Final Verdict; Execution Sentence banks 20% of all
 * damage dealt during its 8s window, then detonates (Touch of the Magi
 * pattern). Hammer of Wrath/executes excluded — the dummy never leaves
 * 100% HP.
 * Talent assumptions: Art of War (autos reset Blade of Justice, 20%
 * APPROX), Herald of the Sun — Dawnlight is modeled as a player-side sun
 * orb (buff with ticks) rather than a target DoT, since its 8s-per-30s
 * cadence is nowhere near full uptime. Apex: Highlord's Judgment 3/3
 * (Judgment amp 35%, Final Verdict 20% chance to reset Judgment).
 * S2 tier: 2pc Blade of Justice +30% (folded into the coefficient);
 * 4pc Wake of Ashes calls a second Dawnlight (folded into the tick).
 * APPROX-flagged: auto cadence, proc rates. Damage in AP units.
 */

const AUTO_COEFF = 0.25
const SWING_TIME = 2.0
const AOW_CHANCE = 0.20      // APPROX: Art of War per swing
const BOJ_COEFF = 1.45       // incl. S2 2pc +30%
const JUDGMENT_COEFF = 1.0
const JUDGMENT_AMP = 1.35    // Apex: Highlord's Judgment
const JUDGMENT_RESET = 0.20  // Apex: Final Verdict reset chance
const CS_COEFF = 0.8
const WAKE_COEFF = 2.2
const DAWNLIGHT_TICK = 0.28  // incl. S2 4pc second Dawnlight
const FV_COEFF = 2.4
const ES_HIT = 0.8
const ES_PCT = 0.20
const AW_AMP = 1.20

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

export const retPaladin: SpecConfig = {
  name: 'Retribution Paladin',
  specId: 'paladin-retribution',
  specIcon: 'spell_holy_auraoflight',
  resourceName: 'Holy Power',
  resourceMax: 5,
  startingResource: 0,

  onCombatStart: (s) => {
    const swing = () => {
      retDamage(s, 'Auto Attack', AUTO_COEFF)
      // Art of War: swings can reset Blade of Justice
      if (s.rng('art_of_war') < AOW_CHANCE) s.resetCooldown('blade_of_justice')
      s.schedule(s.time + SWING_TIME * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'judgment', name: 'Judgment', icon: 'spell_holy_righteousfury', duration: 15, debuff: true },
    { id: 'avenging_wrath', name: 'Avenging Wrath', icon: 'spell_holy_avenginewrath', duration: 20 },
    {
      // Herald of the Sun: modeled as a player-side sun orb, not a target DoT
      id: 'dawnlight', name: 'Dawnlight', icon: 'inv_ability_heraldofthesunpaladin_dawnlight', duration: 8,
      tick: { interval: 1, hasted: false, onTick: s => retDamage(s, 'Dawnlight', DAWNLIGHT_TICK) },
    },
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
      onResolve: (s) => {
        retDamage(s, 'blade_of_justice', BOJ_COEFF)
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
      id: 'crusader_strike',
      name: 'Crusader Strike',
      icon: 'spell_holy_crusaderstrike',
      spellId: 35395,
      cooldown: 6,
      charges: 2,
      onResolve: (s) => {
        retDamage(s, 'crusader_strike', CS_COEFF)
        s.gain(1, 'crusader_strike')
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
        s.applyAura('player', 'dawnlight') // Herald of the Sun (+ 4pc folded)
      },
    },
    {
      id: 'final_verdict',
      name: 'Final Verdict',
      icon: 'spell_paladin_templarsverdict',
      spellId: 383328,
      cost: 3,
      onResolve: (s) => {
        let mult = 1
        if (s.auraRemains('target', 'judgment') > 0) {
          s.removeAura('target', 'judgment')
          mult = JUDGMENT_AMP
        }
        retDamage(s, 'final_verdict', FV_COEFF * mult)
        // Apex: Highlord's Judgment — chance to reset Judgment
        if (s.rng('judgment_reset') < JUDGMENT_RESET) s.resetCooldown('judgment')
      },
    },
    {
      id: 'execution_sentence',
      name: 'Execution Sentence',
      icon: 'spell_paladin_executionsentence',
      spellId: 343527,
      cost: 3,
      cooldown: 60,
      onResolve: (s) => {
        retDamage(s, 'execution_sentence', ES_HIT)
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
    'blade_of_justice', 'judgment', 'crusader_strike', 'wake_of_ashes',
    'final_verdict', 'execution_sentence', 'avenging_wrath',
  ],

  damageMult: (s) => (s.auraRemains('player', 'avenging_wrath') > 0 ? AW_AMP : 1),

  glows: (s, id) => {
    switch (id) {
      case 'final_verdict': return s.insanity === 5 || (s.insanity >= 3 && s.auraRemains('target', 'judgment') > 0)
      case 'wake_of_ashes': return s.cooldownRemains('wake_of_ashes') === 0 && s.insanity <= 2
      case 'execution_sentence': return s.cooldownRemains('execution_sentence') === 0 && s.insanity >= 3
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'avenging_wrath', text: 'Off-GCD, on cooldown', when: s => s.cooldownRemains('avenging_wrath') === 0 },
    { abilityId: 'execution_sentence', text: 'On cooldown with 3+ HP — then pump damage into its window', when: s => s.cooldownRemains('execution_sentence') === 0 && s.insanity >= 3 },
    { abilityId: 'wake_of_ashes', text: 'At ≤2 HP (grants 3 + Dawnlight)', when: s => s.cooldownRemains('wake_of_ashes') === 0 && s.insanity <= 2 },
    { abilityId: 'final_verdict', text: 'At 5 HP — never cap', when: s => s.insanity === 5 },
    { abilityId: 'blade_of_justice', text: 'At ≤3 HP (Art of War resets it often)', when: s => s.cooldownRemains('blade_of_justice') === 0 && s.insanity <= 3 },
    { abilityId: 'final_verdict', text: 'At 3+ HP with the Judgment debuff up (+35%)', when: s => s.insanity >= 3 && s.auraRemains('target', 'judgment') > 0 },
    { abilityId: 'judgment', text: 'On cooldown at ≤4 HP', when: s => s.cooldownRemains('judgment') === 0 && s.insanity <= 4 },
    { abilityId: 'crusader_strike', text: 'Filler builder at ≤4 HP' },
    { abilityId: 'final_verdict', text: 'Spend at 3+ HP when nothing else is up' },
  ],

  policy: (s) => {
    const hp = s.insanity
    const judgmentUp = s.auraRemains('target', 'judgment') > 0

    if (s.cooldownRemains('avenging_wrath') === 0) return 'avenging_wrath'
    if (s.cooldownRemains('execution_sentence') === 0 && hp >= 3) return 'execution_sentence'
    if (s.cooldownRemains('wake_of_ashes') === 0 && hp <= 2) return 'wake_of_ashes'
    if (hp === 5) return 'final_verdict'
    if (s.cooldownRemains('blade_of_justice') === 0 && hp <= 3) return 'blade_of_justice'
    if (hp >= 3 && judgmentUp) return 'final_verdict'
    if (s.cooldownRemains('judgment') === 0 && hp <= 4) return 'judgment'
    if (s.chargesOf('crusader_strike') > 0 && hp <= 4) return 'crusader_strike'
    if (hp >= 3) return 'final_verdict'
    return null
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['crusader_strike', 'judgment', 'blade_of_justice']
    const spenders = ['final_verdict', 'execution_sentence']
    const sets = [builders, spenders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
