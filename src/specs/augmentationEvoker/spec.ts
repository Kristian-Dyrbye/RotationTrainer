import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Augmentation Evoker — patch 12.1.0 (Midnight, Season 2), Chronowarden
 * raid ST build. Chronowarden remains the recommended raid hero talent in
 * 12.1 (~4% over Scalecommander after the last tuning pass).
 *
 * Sources (verified 2026-08-24):
 * - Wowhead rotation guide:
 *   https://www.wowhead.com/guide/classes/evoker/augmentation/rotation-cooldowns-pve-dps
 * - Icy Veins rotation + easy mode + builds:
 *   https://www.icy-veins.com/wow/augmentation-evoker-pve-dps-rotation-cooldowns-abilities
 *   https://www.icy-veins.com/wow/augmentation-evoker-pve-dps-easy-mode
 *   https://www.icy-veins.com/wow/augmentation-evoker-pve-dps-spec-builds-talents
 * - Method playstyle guide:
 *   https://www.method.gg/guides/augmentation-evoker/playstyle-and-rotation
 *
 * ============================ BIG ABSTRACTION ============================
 * Augmentation is a SUPPORT spec: most of its output is damage that buffed
 * allies deal. The engine has no raid, so every ally contribution is
 * modeled as ATTRIBUTED DAMAGE EVENTS on the training dummy ('Allies (Ebon
 * Might)', 'Ally crit (Prescience)', the Breath of Eons detonation). The
 * score therefore reflects buff-uptime play, not literal personal DPS.
 * ========================================================================
 *
 * 12.1 rotation shape (all sources agree): refresh Ebon Might at <4s left;
 * Breath of Eons on cooldown inside Ebon Might; Prescience on cooldown
 * without overcapping charges; Tip the Scales paired with Fire Breath;
 * empowers (Fire Breath, Upheaval) on cooldown; Time Skip once both
 * empowers are down; Eruption inside Ebon Might or at 2 Essence Bursts;
 * Chrono Flame (the Chronowarden Living Flame) as filler.
 *
 * S2 tier: 2pc Upheaval cooldown -10s (folded into the 30s cooldown);
 * 4pc Upheaval magnifies Fate Mirror echoes for 8s (modeled as a 3x
 * Prescience-pulse amp after each Upheaval).
 *
 * Resource model: Essence (max 5), 1 regenerated every 5s (hasted).
 * Essence Burst procs make Eruption free. Empowers fixed at a 2.5s cast
 * (APPROX; Tip the Scales makes the next Fire Breath instant).
 * APPROX list: all ally-attribution coefficients and proc rates; Fire
 * Breath dot held at rank-1/Blast Furnace pacing (24s) despite the guides
 * empowering higher inside Ebon Might; Time Skip flattened to an instant
 * 15s refund on both empower cooldowns + a Temporal Burst haste buff; the
 * Duplicate Apex talent, Reverberations dot, and Blistering Scales are
 * unmodeled. Damage in SP units.
 */

const EM_PULSE = 0.75         // APPROX: allies' extra damage per second
const PRESCIENCE_PULSE = 0.15 // APPROX: per stack, every 3s
const FATE_MIRROR_AMP = 3     // S2 4pc: Prescience echoes tripled after Upheaval
const ERUPTION_COEFF = 1.2
const FB_DIRECT = 1.3
const FB_TICK = 0.3           // every 2s over 24s
const UPHEAVAL_COEFF = 2.6    // incl. the Reverberations dot, flattened
const CHRONO_FLAME_COEFF = 0.95
const BOE_PCT = 0.35          // APPROX: detonation share of banked damage
const TEMPORAL_BURST_HASTE = 0.1
const EB_BASE_CHANCE = 0.15   // + crit chance, per Chrono Flame

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
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/evoker/augmentation/rotation-cooldowns-pve-dps',
    buildName: 'Raiding Build — Chronowarden (Icy Veins default raid build)',
    heroTalent: 'Chronowarden',
    // published verbatim on icy-veins.com/wow/augmentation-evoker-pve-dps-spec-builds-talents
    talentString: 'CEcBAAAAAAAAAAAAAAAAAAAAAMMzMbzMzgZYmZZGzMjZ2AAAAAAAAYmhxMYM1YmZGAAAAMjZMmZWGzMwMMwYGLsADMDDNwCGjZGAYA',
    retrieved: '2026-08-24',
  },
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
        onTick: (s, aura) => {
          // S2 4pc: Upheaval magnifies the Fate Mirror echo for 8s
          const amp = s.auraRemains('player', 'fate_mirror_amp') > 0 ? FATE_MIRROR_AMP : 1
          augDamage(s, 'Ally crit (Prescience)', PRESCIENCE_PULSE * aura.stacks * amp)
        },
      },
    },
    { id: 'fate_mirror_amp', name: 'Fate Mirror', icon: 'ability_evoker_prescience', duration: 8 },
    { id: 'tip_the_scales', name: 'Tip the Scales', icon: 'ability_evoker_tipthescales', duration: 30 },
    {
      id: 'temporal_burst', name: 'Temporal Burst', icon: 'ability_evoker_fontofmagic', duration: 10,
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
      },
    },
    {
      id: 'fire_breath',
      name: 'Fire Breath',
      icon: 'ability_evoker_firebreath',
      spellId: 357208,
      castTime: 2.5, // APPROX: fixed empower; instant with Tip the Scales
      castTimeMod: (s, base) => (s.auraRemains('player', 'tip_the_scales') > 0 ? 0 : base),
      cooldown: 30,
      onResolve: (s) => {
        if (s.auraRemains('player', 'tip_the_scales') > 0) s.removeAura('player', 'tip_the_scales')
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
      castTime: 2.5, // APPROX: fixed empower
      cooldown: 30,  // 40s base, S2 2pc -10s folded in
      onResolve: (s) => {
        augDamage(s, 'upheaval', UPHEAVAL_COEFF)
        extendEbonMight(s, 2)
        s.applyAura('player', 'fate_mirror_amp') // S2 4pc window
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
      id: 'tip_the_scales',
      name: 'Tip the Scales',
      icon: 'ability_evoker_tipthescales',
      spellId: 370553,
      offGcd: true,
      cooldown: 90, // 120s base, Chronoboon -30s
      onResolve: (s) => s.applyAura('player', 'tip_the_scales'),
    },
    {
      id: 'time_skip',
      name: 'Time Skip',
      icon: 'ability_evoker_timeskip',
      spellId: 404977,
      cooldown: 120,
      onResolve: (s) => {
        // APPROX: the channel is flattened to an instant 15s fast-forward
        s.reduceCooldown('fire_breath', 15)
        s.reduceCooldown('upheaval', 15)
        s.applyAura('player', 'temporal_burst') // Chronowarden haste surge
      },
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
      id: 'chrono_flame',
      name: 'Chrono Flame',
      icon: 'inv_ability_chronowardenevoker_chronoflame',
      spellId: 431443,
      castTime: 2.25,
      onResolve: (s) => {
        augDamage(s, 'chrono_flame', CHRONO_FLAME_COEFF)
        if (s.rng('essence_burst') < EB_BASE_CHANCE + s.stats.critChance) {
          s.applyAura('player', 'essence_burst', { stacks: 1 })
        }
      },
    },
  ],

  actionBar: [
    'ebon_might', 'eruption', 'fire_breath', 'upheaval',
    'prescience', 'tip_the_scales', 'time_skip', 'breath_of_eons', 'chrono_flame',
  ],

  hasteMod: (s) => (s.auraRemains('player', 'temporal_burst') > 0 ? TEMPORAL_BURST_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'ebon_might': return s.auraRemains('player', 'ebon_might') < 4 && s.cooldownRemains('ebon_might') === 0
      case 'eruption': return s.stacks('player', 'essence_burst') > 0
      case 'breath_of_eons': return s.cooldownRemains('breath_of_eons') === 0 && s.auraRemains('player', 'ebon_might') > 0
      case 'fire_breath': return s.auraRemains('player', 'tip_the_scales') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'ebon_might', text: 'The spec: refresh Ebon Might at <4s remaining — never let it drop', when: s => s.cooldownRemains('ebon_might') === 0 && s.auraRemains('player', 'ebon_might') < 4 },
    { abilityId: 'breath_of_eons', text: 'On cooldown, inside Ebon Might (banks 8s of damage, then detonates)', when: s => s.cooldownRemains('breath_of_eons') === 0 && s.auraRemains('player', 'ebon_might') > 0 },
    { abilityId: 'prescience', text: 'On cooldown — never sit at 2 charges (S2 4pc feeds it)', when: s => s.chargesOf('prescience') === 2 || (s.chargesOf('prescience') > 0 && s.stacks('player', 'prescience_buff') < 2) },
    { abilityId: 'tip_the_scales', text: 'Pair with Fire Breath for an instant empower', when: s => s.cooldownRemains('tip_the_scales') === 0 && s.cooldownRemains('fire_breath') === 0 },
    { abilityId: 'fire_breath', text: 'On cooldown — dot + extends Ebon Might 2s', when: s => s.cooldownRemains('fire_breath') === 0 },
    { abilityId: 'upheaval', text: 'On cooldown (30s with 2pc) — extends Ebon Might, magnifies Fate Mirror (4pc)', when: s => s.cooldownRemains('upheaval') === 0 },
    { abilityId: 'time_skip', text: 'When both empowers are on cooldown — fast-forwards them 15s', when: s => s.cooldownRemains('time_skip') === 0 && s.cooldownRemains('fire_breath') > 0 && s.cooldownRemains('upheaval') > 0 },
    { abilityId: 'eruption', text: 'Inside Ebon Might with Essence Burst or 3+ Essence (each cast extends it 1s)' },
    { abilityId: 'chrono_flame', text: 'Filler — fishes for Essence Burst' },
  ],

  policy: (s) => {
    const emUp = s.auraRemains('player', 'ebon_might') > 0
    const eb = s.stacks('player', 'essence_burst')

    if (s.cooldownRemains('ebon_might') === 0 && s.auraRemains('player', 'ebon_might') < 4) return 'ebon_might'
    if (s.cooldownRemains('breath_of_eons') === 0 && emUp) return 'breath_of_eons'
    if (s.chargesOf('prescience') === 2 || (s.chargesOf('prescience') > 0 && s.stacks('player', 'prescience_buff') < 2)) return 'prescience'
    if (s.cooldownRemains('tip_the_scales') === 0 && s.cooldownRemains('fire_breath') === 0) return 'tip_the_scales'
    if (s.cooldownRemains('fire_breath') === 0) return 'fire_breath'
    if (s.cooldownRemains('upheaval') === 0) return 'upheaval'
    if (s.cooldownRemains('time_skip') === 0 && s.cooldownRemains('fire_breath') > 0 && s.cooldownRemains('upheaval') > 0) return 'time_skip'
    if ((emUp && (eb > 0 || s.insanity >= 3)) || eb >= 2) return 'eruption'
    return 'chrono_flame'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const empowers = ['fire_breath', 'upheaval']
    const fillers = ['chrono_flame', 'eruption']
    const buffs = ['prescience', 'ebon_might']
    const sets = [empowers, fillers, buffs]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
