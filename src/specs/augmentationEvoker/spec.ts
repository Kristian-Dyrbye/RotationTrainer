import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Augmentation Evoker — patch 12.1.0 (Midnight, Season 2), Chronowarden
 * raid ST build. Built from the simc `midnight` APL/source and
 * Icy Veins/Wowhead 12.1 guides.
 *
 * ============================ BIG ABSTRACTION ============================
 * Augmentation is a SUPPORT spec: most of its output is damage that buffed
 * allies deal. The v1 engine has no raid, so every ally contribution is
 * modeled as ATTRIBUTED DAMAGE EVENTS on the training dummy ('Allies (Ebon
 * Might)', 'Ally crit (Prescience)', the Breath of Eons detonation). The
 * score therefore reflects buff-uptime play, not literal personal DPS.
 * ========================================================================
 *
 * Resource model: Essence (max 5), 1 regenerated every 5s (hasted).
 * Essence Burst procs make Eruption free. Empowers fixed at 2.5s (APPROX).
 * Talent assumptions: Ebon Might extended by Eruption (+1s) and by
 * empowers (+2s), Apex: Rumbling Earth 3/3 (Eruption also extends Fire
 * Breath 1s, up to 8s per breath). S2 tier: 2pc Fire Breath dot +6s
 * (folded into the 24s duration); 4pc Prescience pulses +25% (folded).
 * APPROX-flagged: all ally-attribution coefficients, proc rates.
 * Damage in SP units.
 */

const EM_PULSE = 0.75         // APPROX: allies' extra damage per second
const PRESCIENCE_PULSE = 0.15 // APPROX: per stack, every 3s, incl. S2 4pc
const ERUPTION_COEFF = 1.2
const FB_DIRECT = 1.3
const FB_TICK = 0.3           // every 2s over 24s
const UPHEAVAL_COEFF = 2.6
const LF_COEFF = 0.9
const BOE_PCT = 0.35          // APPROX: detonation share of banked damage
const EB_CHANCE = 0.30        // APPROX: Essence Burst per Living Flame

/**
 * All damage funnels through here so Breath of Eons can bank a share of
 * everything dealt inside its 8s window (expected-value, APPROX).
 */
function augDamage(s: SimAPI, id: string, coeff: number, opts?: { canCrit?: boolean }) {
  s.damage(id, coeff, opts)
  const boe = s.aura('target', 'breath_of_eons')
  if (boe) {
    const canCrit = opts?.canCrit ?? true
    const expected = canCrit ? coeff * (1 + s.stats.critChance * (s.stats.critMult - 1)) : coeff
    boe.data.bank = (boe.data.bank ?? 0) + expected
  }
}

function extendEbonMight(s: SimAPI, seconds: number) {
  if (s.auraRemains('player', 'ebon_might') > 0) s.extendAura('player', 'ebon_might', seconds)
}

export const augmentationEvoker: SpecConfig = {
  name: 'Augmentation Evoker',
  specId: 'evoker-augmentation',
  specIcon: 'classicon_evoker_augmentation',
  resourceName: 'Essence',
  resourceMax: 5,
  startingResource: 3,

  onCombatStart: (s) => {
    const regen = () => {
      s.gain(1, 'essence_regen')
      s.schedule(s.time + 5 * s.hasteMult(), regen)
    }
    s.schedule(s.time + 5 * s.hasteMult(), regen)
  },

  auras: [
    { id: 'essence_burst', name: 'Essence Burst', icon: 'ability_evoker_essenceburst', duration: 15, maxStacks: 2 },
    {
      id: 'ebon_might', name: 'Ebon Might', icon: 'spell_sarkareth', duration: 10,
      // allies' buffed damage, attributed (see header)
      tick: { interval: 1, hasted: false, onTick: s => augDamage(s, 'Allies (Ebon Might)', EM_PULSE) },
    },
    {
      id: 'prescience_buff', name: 'Prescience', icon: 'ability_evoker_prescience', duration: 18, maxStacks: 2,
      tick: {
        interval: 3, hasted: false,
        onTick: (s, aura) => augDamage(s, 'Ally crit (Prescience)', PRESCIENCE_PULSE * aura.stacks),
      },
    },
    {
      id: 'fire_breath_dot', name: 'Fire Breath', icon: 'ability_evoker_firebreath', duration: 24, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => augDamage(s, 'fire_breath_dot', FB_TICK) },
    },
    {
      id: 'breath_of_eons', name: 'Breath of Eons', icon: 'ability_evoker_breathofeons', duration: 8, debuff: true,
      onExpire: (s, aura) => {
        const boom = (aura.data.bank ?? 0) * BOE_PCT
        if (boom > 0) s.damage('Breath of Eons', boom, { canCrit: false })
      },
    },
  ],

  abilities: [
    {
      id: 'ebon_might',
      name: 'Ebon Might',
      icon: 'spell_sarkareth',
      spellId: 395152,
      cooldown: 30,
      onResolve: (s) => s.applyAura('player', 'ebon_might'),
    },
    {
      id: 'eruption',
      name: 'Eruption',
      icon: 'ability_evoker_eruption',
      spellId: 395160,
      cost: 3,
      costMod: (s) => (s.stacks('player', 'essence_burst') > 0 ? 0 : 3),
      onResolve: (s) => {
        if (s.stacks('player', 'essence_burst') > 0) s.consumeStack('player', 'essence_burst')
        augDamage(s, 'eruption', ERUPTION_COEFF)
        extendEbonMight(s, 1)
        // Apex: Rumbling Earth — Eruption extends Fire Breath 1s, 8s cap
        const fb = s.aura('target', 'fire_breath_dot')
        if (fb && (fb.data.ext ?? 0) < 8) {
          fb.data.ext = (fb.data.ext ?? 0) + 1
          s.extendAura('target', 'fire_breath_dot', 1)
        }
      },
    },
    {
      id: 'fire_breath',
      name: 'Fire Breath',
      icon: 'ability_evoker_firebreath',
      spellId: 357208,
      castTime: 2.5, // APPROX: fixed full empower
      cooldown: 30,
      onResolve: (s) => {
        augDamage(s, 'fire_breath', FB_DIRECT)
        s.applyAura('target', 'fire_breath_dot')
        extendEbonMight(s, 2)
      },
    },
    {
      id: 'upheaval',
      name: 'Upheaval',
      icon: 'ability_evoker_upheaval',
      spellId: 396286,
      castTime: 2.5, // APPROX: fixed full empower
      cooldown: 40,
      onResolve: (s) => {
        augDamage(s, 'upheaval', UPHEAVAL_COEFF)
        extendEbonMight(s, 2)
      },
    },
    {
      id: 'prescience',
      name: 'Prescience',
      icon: 'ability_evoker_prescience',
      spellId: 409311,
      cooldown: 12,
      charges: 2,
      onResolve: (s) => s.applyAura('player', 'prescience_buff', { stacks: 1 }),
    },
    {
      id: 'breath_of_eons',
      name: 'Breath of Eons',
      icon: 'ability_evoker_breathofeons',
      spellId: 403631,
      cooldown: 120,
      onResolve: (s) => s.applyAura('target', 'breath_of_eons'),
    },
    {
      id: 'living_flame',
      name: 'Living Flame',
      icon: 'ability_evoker_livingflame',
      spellId: 361469,
      castTime: 2.25,
      onResolve: (s) => {
        augDamage(s, 'living_flame', LF_COEFF)
        if (s.rng('essence_burst') < EB_CHANCE) s.applyAura('player', 'essence_burst', { stacks: 1 })
      },
    },
  ],

  actionBar: [
    'ebon_might', 'eruption', 'fire_breath', 'upheaval',
    'prescience', 'breath_of_eons', 'living_flame',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'ebon_might': return s.auraRemains('player', 'ebon_might') === 0 && s.cooldownRemains('ebon_might') === 0
      case 'eruption': return s.stacks('player', 'essence_burst') > 0
      case 'breath_of_eons': return s.cooldownRemains('breath_of_eons') === 0 && s.auraRemains('player', 'ebon_might') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'ebon_might', text: 'The spec: keep Ebon Might up — recast the moment it drops', when: s => s.auraRemains('player', 'ebon_might') === 0 && s.cooldownRemains('ebon_might') === 0 },
    { abilityId: 'breath_of_eons', text: 'On cooldown, inside Ebon Might (banks 8s of damage, then detonates)', when: s => s.cooldownRemains('breath_of_eons') === 0 && s.auraRemains('player', 'ebon_might') > 0 },
    { abilityId: 'fire_breath', text: 'On cooldown — dot + extends Ebon Might (Eruptions stretch the dot, Apex)', when: s => s.cooldownRemains('fire_breath') === 0 },
    { abilityId: 'upheaval', text: 'On cooldown — extends Ebon Might', when: s => s.cooldownRemains('upheaval') === 0 },
    { abilityId: 'prescience', text: 'Keep 2 Prescience targets rolling', when: s => s.chargesOf('prescience') > 0 && s.stacks('player', 'prescience_buff') < 2 },
    { abilityId: 'eruption', text: 'Essence Burst or 3+ Essence — each cast extends Ebon Might 1s' },
    { abilityId: 'living_flame', text: 'Filler — fishes for Essence Burst' },
  ],

  policy: (s) => {
    const emUp = s.auraRemains('player', 'ebon_might') > 0
    const eb = s.stacks('player', 'essence_burst')

    if (!emUp && s.cooldownRemains('ebon_might') === 0) return 'ebon_might'
    if (s.cooldownRemains('breath_of_eons') === 0 && emUp) return 'breath_of_eons'
    if (s.cooldownRemains('fire_breath') === 0) return 'fire_breath'
    if (s.cooldownRemains('upheaval') === 0) return 'upheaval'
    if (s.chargesOf('prescience') > 0 && s.stacks('player', 'prescience_buff') < 2) return 'prescience'
    if (eb > 0 || s.insanity >= 3) return 'eruption'
    return 'living_flame'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const empowers = ['fire_breath', 'upheaval']
    const fillers = ['living_flame', 'eruption']
    const buffs = ['prescience', 'ebon_might']
    const sets = [empowers, fillers, buffs]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
