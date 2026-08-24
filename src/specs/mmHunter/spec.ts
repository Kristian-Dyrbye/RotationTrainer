import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Marksmanship Hunter — patch 12.1.0 (Midnight, Season 2), Dark Ranger raid
 * ST build, Lone Wolf (petless — the 12.0 rework has stabilized by 12.1).
 * Built from the simc `midnight` APL/source and Icy Veins/Wowhead guides.
 *
 * Resource model: Focus, 100 cap, 5/s hasted passive regen (0.5s
 * granularity); Steady Shot and Rapid Fire ticks generate on top.
 * Talent assumptions: Lone Wolf, Precise Shots, Black Arrow baseline (Dark
 * Ranger), Deathblow (Black Arrow ticks can arm a free instant Aimed Shot),
 * Apex: Deathwarden's Volley 3/3 (Deathblow Aimed Shots fire a Black Arrow
 * volley on impact).
 * S2 tier: 2pc Rapid Fire +25% (folded into the tick coefficient); 4pc Rapid
 * Fire ticks refund 0.3s of Aimed Shot recharge each. APPROX-flagged:
 * Deathblow proc rate, Trueshot as flat haste, volley coefficient.
 * Damage in AP units.
 */

const AIMED_COEFF = 2.8
const ARCANE_COEFF = 1.0
const PRECISE_MULT = 1.75
const STEADY_COEFF = 0.55
const STEADY_FOCUS = 10
const RF_TICK = 0.36          // 7 ticks, incl. S2 2pc +25%
const BA_DIRECT = 0.30
const BA_TICK = 0.30
const VOLLEY_COEFF = 0.90     // APPROX: Apex volley
const TRUESHOT_HASTE = 0.30
const DEATHBLOW_CHANCE = 0.12 // APPROX: per Black Arrow tick

function deathblowUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'deathblow') > 0
}

export const mmHunter: SpecConfig = {
  name: 'Marksmanship Hunter',
  specId: 'hunter-marksmanship',
  specIcon: 'ability_hunter_focusedaim',
  resourceName: 'Focus',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    const regen = () => {
      s.gain(2.5 / s.hasteMult(), 'focus_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
  },

  auras: [
    { id: 'precise_shots', name: 'Precise Shots', icon: 'ability_hunter_focusedaim', duration: 15, maxStacks: 2 },
    { id: 'deathblow', name: 'Deathblow', icon: 'ability_hunter_assassinate', duration: 12 },
    { id: 'trueshot', name: 'Trueshot', icon: 'ability_trueshot', duration: 15 },
    {
      id: 'black_arrow', name: 'Black Arrow', icon: 'spell_shadow_painspike', duration: 18, pandemic: true, debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          s.damage('black_arrow', BA_TICK)
          if (s.rng('deathblow') < DEATHBLOW_CHANCE) s.applyAura('player', 'deathblow')
        },
      },
    },
  ],

  abilities: [
    {
      id: 'aimed_shot',
      name: 'Aimed Shot',
      icon: 'inv_spear_07',
      spellId: 19434,
      castTime: 2.5,
      cooldown: 12,
      charges: 2,
      cost: 35,
      costMod: (s) => (deathblowUp(s) ? 0 : 35),
      castTimeMod: (s, base) => (deathblowUp(s) ? 0 : base),
      noCooldownIf: (s) => deathblowUp(s),
      onResolve: (s) => {
        const db = deathblowUp(s)
        if (db) s.removeAura('player', 'deathblow')
        s.damage('aimed_shot', AIMED_COEFF)
        s.applyAura('player', 'precise_shots', { stacks: 2 })
        if (db) {
          // Apex: Deathwarden's Volley — Deathblow Aimed Shots fire a volley
          s.schedule(s.time + 0.3, () => s.damage("Deathwarden's Volley", VOLLEY_COEFF))
          s.applyAura('target', 'black_arrow')
        }
      },
    },
    {
      id: 'arcane_shot',
      name: 'Arcane Shot',
      icon: 'ability_impalingbolt',
      spellId: 185358,
      cost: 40,
      costMod: (s) => (s.stacks('player', 'precise_shots') > 0 ? 20 : 40),
      onResolve: (s) => {
        let mult = 1
        if (s.stacks('player', 'precise_shots') > 0) {
          s.consumeStack('player', 'precise_shots')
          mult = PRECISE_MULT
        }
        s.damage('arcane_shot', ARCANE_COEFF * mult)
      },
    },
    {
      id: 'steady_shot',
      name: 'Steady Shot',
      icon: 'ability_hunter_steadyshot',
      spellId: 56641,
      castTime: 1.75,
      onResolve: (s) => {
        s.damage('steady_shot', STEADY_COEFF)
        s.gain(STEADY_FOCUS, 'steady_shot')
      },
    },
    {
      id: 'rapid_fire',
      name: 'Rapid Fire',
      icon: 'ability_hunter_efficiency',
      spellId: 257044,
      cooldown: 20,
      channel: {
        duration: 2,
        ticks: 7,
        hasted: true,
        onTick: (s) => {
          s.damage('rapid_fire', RF_TICK)
          s.gain(1, 'rapid_fire')
          s.reduceCooldown('aimed_shot', 0.3) // S2 4pc
        },
      },
      onResolve: () => {},
    },
    {
      id: 'black_arrow',
      name: 'Black Arrow',
      icon: 'spell_shadow_painspike',
      spellId: 466930,
      cost: 15,
      onResolve: (s) => {
        s.damage('black_arrow_impact', BA_DIRECT)
        s.applyAura('target', 'black_arrow')
      },
    },
    {
      id: 'trueshot',
      name: 'Trueshot',
      icon: 'ability_trueshot',
      spellId: 288613,
      cooldown: 120,
      onResolve: (s) => {
        s.applyAura('player', 'trueshot')
        s.resetCooldown('rapid_fire')
      },
    },
  ],

  actionBar: [
    'aimed_shot', 'arcane_shot', 'steady_shot', 'rapid_fire', 'black_arrow', 'trueshot',
  ],

  hasteMod: (s) => (s.auraRemains('player', 'trueshot') > 0 ? TRUESHOT_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'aimed_shot': return deathblowUp(s)
      case 'arcane_shot': return s.stacks('player', 'precise_shots') > 0
      case 'black_arrow': return s.auraRemains('target', 'black_arrow') < 5
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'trueshot', text: 'On cooldown (resets Rapid Fire)', when: s => s.cooldownRemains('trueshot') === 0 },
    { abilityId: 'aimed_shot', text: 'Deathblow proc — instant, free, fires a volley (Apex)', when: s => deathblowUp(s) },
    { abilityId: 'black_arrow', text: 'Keep the DoT rolling (refresh under ~5s)', when: s => s.auraRemains('target', 'black_arrow') < 5 },
    { abilityId: 'rapid_fire', text: 'On cooldown — generates Focus, refunds Aimed recharge (4pc)', when: s => s.cooldownRemains('rapid_fire') === 0 },
    { abilityId: 'arcane_shot', text: 'Spend Precise Shots before the next Aimed Shot', when: s => s.stacks('player', 'precise_shots') > 0 },
    { abilityId: 'aimed_shot', text: 'Keep charges rolling with 35+ Focus' },
    { abilityId: 'arcane_shot', text: 'Dump above ~80 Focus' },
    { abilityId: 'steady_shot', text: 'Filler — builds Focus' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Rapid Fire
    const focus = s.insanity
    const ps = s.stacks('player', 'precise_shots')

    if (s.cooldownRemains('trueshot') === 0) return 'trueshot'
    if (deathblowUp(s)) return 'aimed_shot'
    if (s.auraRemains('target', 'black_arrow') < 5 && focus >= 15) return 'black_arrow'
    if (s.cooldownRemains('rapid_fire') === 0) return 'rapid_fire'
    if (ps > 0 && focus >= 20) return 'arcane_shot'
    if (s.chargesOf('aimed_shot') > 0 && focus >= 35) return 'aimed_shot'
    if (focus >= 80) return 'arcane_shot'
    return 'steady_shot'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const spenders = ['arcane_shot', 'aimed_shot']
    const fillers = ['steady_shot', 'arcane_shot']
    const sets = [spenders, fillers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
