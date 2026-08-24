import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Devourer Demon Hunter — patch 12.1.0 (Midnight, Season 2). The third DH
 * spec added in 12.1: a mid-range dark melee that starves its prey and
 * consumes the soul essence that bleeds out of it.
 *
 * ENTIRE MODULE IS APPROX: modeled from 12.1 preview notes, the simc
 * `midnight` branch prototype APL, and early Wowhead datamining — very
 * little of this kit has confirmed numbers yet. Re-verify everything in
 * the phase-0 SpellQuery pass.
 *
 * Kit summary (12.1 launch design, flattened burst per the patch theme):
 * - Hunger (max 100): built by autos, Soul Rend, and Wasting Curse ticks.
 * - Soul Fragments (max 5): conjured by Soul Rend and Wasting Curse;
 *   Consuming Maw eats them all for +15% damage each.
 * - Wasting Curse: the maintenance DoT; its ticks feed Hunger, fragments,
 *   and the Hollow Hunger proc (next Consuming Maw free).
 * - Essence Drain: short channel, Hunger generator.
 * - Abyssal Maw (90s): big bite + Gaping Maw window (+10% damage taken);
 *   S2 4pc conjures 5 fragments on cast.
 * - Ravenous Form (120s, off-GCD): 18s form, +20% damage and Consuming
 *   Maw costs 35 instead of 50.
 * Apex: Maw of the Void 3/3 — Consuming Maw hits during Gaping Maw extend
 * the window 1s, 4 times. S2 2pc: Essence Drain ticks +25% (folded).
 * Damage in AP units.
 */

const AUTO_COEFF = 0.34          // slow scythe swings, 2.0s
const AUTO_HUNGER = 5
const SOUL_REND_COEFF = 0.72
const SOUL_REND_HUNGER = 15
const WC_TICK = 0.36
const WC_TICK_HUNGER = 3
const WC_FRAG_CHANCE = 0.30      // APPROX
const HOLLOW_CHANCE = 0.10       // APPROX: Hollow Hunger per WC tick
const MAW_COEFF = 2.3
const MAW_PER_FRAG = 0.15
const DRAIN_TICK = 0.52          // 5 ticks, incl. S2 2pc +25%
const DRAIN_TICK_HUNGER = 4
const ABYSSAL_COEFF = 3.0
const GAPING_MAW_AMP = 1.10
const RAVENOUS_DMG = 1.2

function mawCost(s: SimAPI): number {
  if (s.auraRemains('player', 'hollow_hunger') > 0) return 0
  if (s.auraRemains('player', 'ravenous_form') > 0) return 35
  return 50
}

export const devourerDH: SpecConfig = {
  name: 'Devourer Demon Hunter',
  specId: 'dh-devourer',
  specIcon: 'spell_shadow_devouringplague',
  resourceName: 'Hunger',
  resourceMax: 100,
  startingResource: 0,

  onCombatStart: (s) => {
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      s.gain(AUTO_HUNGER, 'auto')
      s.schedule(s.time + 2.0 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.2, swing)
  },

  auras: [
    { id: 'soul_fragments', name: 'Soul Fragments', icon: 'spell_shadow_soulgem', duration: 30, maxStacks: 5 },
    { id: 'hollow_hunger', name: 'Hollow Hunger', icon: 'spell_shadow_requiem', duration: 12 },
    { id: 'ravenous_form', name: 'Ravenous Form', icon: 'ability_demonhunter_metamorphasisdps', duration: 18 },
    { id: 'gaping_maw', name: 'Gaping Maw', icon: 'spell_shadow_shadesofdarkness', duration: 12, debuff: true },
    {
      id: 'wasting_curse', name: 'Wasting Curse', icon: 'spell_shadow_curseofsargeras', duration: 18, pandemic: true, debuff: true,
      tick: {
        interval: 3, hasted: true,
        onTick: (s) => {
          s.damage('wasting_curse', WC_TICK, { tags: ['shadow'] })
          s.gain(WC_TICK_HUNGER, 'wasting_curse')
          if (s.rng('wc_fragment') < WC_FRAG_CHANCE) s.applyAura('player', 'soul_fragments', { stacks: 1 })
          if (s.rng('hollow_hunger') < HOLLOW_CHANCE) s.applyAura('player', 'hollow_hunger')
        },
      },
    },
  ],

  abilities: [
    {
      id: 'soul_rend',
      name: 'Soul Rend',
      icon: 'ability_demonhunter_soulcleave2',
      spellId: 1240001, // APPROX: 12.1 datamined id
      onResolve: (s) => {
        s.damage('soul_rend', SOUL_REND_COEFF, { tags: ['shadow'] })
        s.gain(SOUL_REND_HUNGER, 'soul_rend')
        s.applyAura('player', 'soul_fragments', { stacks: 1 })
      },
    },
    {
      id: 'wasting_curse',
      name: 'Wasting Curse',
      icon: 'spell_shadow_curseofsargeras',
      spellId: 1240004,
      onResolve: (s) => {
        s.damage('wasting_curse', WC_TICK, { tags: ['shadow'] }) // application bite
        s.applyAura('target', 'wasting_curse')
      },
    },
    {
      id: 'consuming_maw',
      name: 'Consuming Maw',
      icon: 'spell_shadow_burningspirit',
      spellId: 1240007,
      cost: 50,
      costMod: mawCost,
      onResolve: (s) => {
        const frags = s.stacks('player', 'soul_fragments')
        if (s.auraRemains('player', 'hollow_hunger') > 0) s.removeAura('player', 'hollow_hunger')
        if (frags > 0) s.removeAura('player', 'soul_fragments')
        s.damage('consuming_maw', MAW_COEFF * (1 + MAW_PER_FRAG * frags), { tags: ['shadow'] })
        // Apex: Maw of the Void — hits during Gaping Maw extend the window 1s, 4×
        const maw = s.aura('target', 'gaping_maw')
        if (maw && (maw.data.ext ?? 0) < 4) {
          maw.data.ext = (maw.data.ext ?? 0) + 1
          s.extendAura('target', 'gaping_maw', 1)
        }
      },
    },
    {
      id: 'essence_drain',
      name: 'Essence Drain',
      icon: 'spell_shadow_lifedrain02',
      spellId: 1240010,
      cooldown: 30,
      channel: {
        duration: 2.5,
        ticks: 5,
        hasted: true,
        onTick: (s) => {
          s.damage('essence_drain', DRAIN_TICK, { tags: ['shadow'] })
          s.gain(DRAIN_TICK_HUNGER, 'essence_drain')
        },
      },
      onResolve: () => {},
    },
    {
      id: 'abyssal_maw',
      name: 'Abyssal Maw',
      icon: 'spell_shadow_shadesofdarkness',
      spellId: 1240013,
      cooldown: 90,
      onResolve: (s) => {
        s.damage('abyssal_maw', ABYSSAL_COEFF, { tags: ['shadow'] })
        s.applyAura('target', 'gaping_maw')
        s.applyAura('player', 'soul_fragments', { stacks: 5 }) // S2 4pc
      },
    },
    {
      id: 'ravenous_form',
      name: 'Ravenous Form',
      icon: 'ability_demonhunter_metamorphasisdps',
      spellId: 1240016,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => s.applyAura('player', 'ravenous_form'),
    },
  ],

  actionBar: [
    'soul_rend', 'consuming_maw', 'wasting_curse', 'essence_drain',
    'abyssal_maw', 'ravenous_form',
  ],

  damageMult: (s) => {
    let m = 1
    if (s.auraRemains('player', 'ravenous_form') > 0) m *= RAVENOUS_DMG
    if (s.auraRemains('target', 'gaping_maw') > 0) m *= GAPING_MAW_AMP
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'consuming_maw': return s.auraRemains('player', 'hollow_hunger') > 0 || s.stacks('player', 'soul_fragments') >= 5
      case 'wasting_curse': return s.auraRemains('target', 'wasting_curse') < 5.4
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'wasting_curse', text: 'Keep it ticking — refresh in the pandemic window (<5.4s)', when: s => s.auraRemains('target', 'wasting_curse') < 5.4 },
    { abilityId: 'ravenous_form', text: 'Off-GCD, on cooldown', when: s => s.cooldownRemains('ravenous_form') === 0 },
    { abilityId: 'abyssal_maw', text: 'On cooldown — opens the Gaping Maw window (+10% taken)', when: s => s.cooldownRemains('abyssal_maw') === 0 },
    { abilityId: 'consuming_maw', text: 'Hollow Hunger (free) or 5 Soul Fragments — extends Gaping Maw (Apex)', when: s => s.auraRemains('player', 'hollow_hunger') > 0 || s.stacks('player', 'soul_fragments') >= 5 },
    { abilityId: 'essence_drain', text: 'On cooldown when it will not overcap Hunger', when: s => s.cooldownRemains('essence_drain') === 0 },
    { abilityId: 'consuming_maw', text: 'At 80+ Hunger — never cap' },
    { abilityId: 'soul_rend', text: 'Filler — builds Hunger and Soul Fragments' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Essence Drain
    const hunger = s.insanity
    const frags = s.stacks('player', 'soul_fragments')
    const wc = s.auraRemains('target', 'wasting_curse')
    const hollow = s.auraRemains('player', 'hollow_hunger') > 0

    if (wc <= 0) return 'wasting_curse'
    if (s.cooldownRemains('ravenous_form') === 0) return 'ravenous_form'
    if (s.cooldownRemains('abyssal_maw') === 0) return 'abyssal_maw'
    if (wc < 5.4) return 'wasting_curse'
    if (hollow) return 'consuming_maw'
    if (frags >= 5 && hunger >= mawCost(s)) return 'consuming_maw'
    if (s.cooldownRemains('essence_drain') === 0 && hunger <= 75) return 'essence_drain'
    if (hunger >= 80) return 'consuming_maw'
    return 'soul_rend'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['soul_rend', 'essence_drain']
    const bites = ['consuming_maw', 'abyssal_maw']
    const sets = [builders, bites]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
