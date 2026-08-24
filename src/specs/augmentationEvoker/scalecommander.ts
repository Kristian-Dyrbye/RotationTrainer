import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Augmentation Evoker — patch 12.1.0 (Midnight, Season 2), Scalecommander
 * raid ST build (alternate to the default Chronowarden build, ~4% behind
 * after the last tuning pass; guides keep Chronowarden as the raid default
 * and Scalecommander for weekly keys — Method still publishes a dedicated
 * "Raid Single Target (Scalecommander)" loadout, modeled here).
 *
 * Sources (verified 2026-08-24):
 * - Wowhead rotation guide:
 *   https://www.wowhead.com/guide/classes/evoker/augmentation/rotation-cooldowns-pve-dps
 * - Icy Veins rotation (Scalecommander toggle of the priority list + the
 *   Breath of Eons / Duplicate FAQ):
 *   https://www.icy-veins.com/wow/augmentation-evoker-pve-dps-rotation-cooldowns-abilities
 * - Method talents (12.1, updated 17 Aug 2026; Scalecommander hero notes and
 *   the raid ST import string, published verbatim):
 *   https://www.method.gg/guides/augmentation-evoker/talents
 *
 * ============================ BIG ABSTRACTION ============================
 * Augmentation is a SUPPORT spec: most of its output is damage that buffed
 * allies deal. The engine has no raid, so every ally contribution is
 * modeled as ATTRIBUTED DAMAGE EVENTS on the training dummy ('Allies (Ebon
 * Might)', 'Ally crit (Prescience)', 'Bombardments (allies)', the Breath of
 * Eons detonation). The score reflects buff-uptime play, not personal DPS.
 * ========================================================================
 *
 * 12.1 Scalecommander shape (Icy Veins SC priority + Method hero notes):
 * refresh Ebon Might at <4s left; Breath of Eons ON COOLDOWN — its Apex
 * talent Duplicate "adds significant value to each cast" (while Duplicate
 * is active Ebon Might grants 75% additional stats and Upheaval/Eruption
 * deal 25% more, with empower/Eruption casts echoed); Deep Breath on
 * cooldown; Prescience on cooldown without overcapping; Tip the Scales
 * paired with Fire Breath; empowers on cooldown; Time Skip once both
 * empowers are down; Eruption inside Ebon Might or at 2 Essence Bursts —
 * empower casts load MASS ERUPTION, which triggers ally Bombardments and
 * (Wingleader) refunds Breath of Eons cooldown; Azure Strike is the ST
 * filler ("Currently Azure Strike is a better builder on Single Target for
 * Scalecommander"), Living Flame the moving/AoE alternative.
 *
 * S2 tier: 2pc Upheaval cooldown -10s (folded into the 30s cooldown);
 * 4pc Upheaval magnifies Fate Mirror echoes for 8s (modeled as a 3x
 * Prescience-pulse amp after each Upheaval).
 *
 * Resource model: Essence (max 5), 1 regenerated every 5s (hasted).
 * Essence Burst procs make Eruption free. Empowers fixed at a 2.5s cast
 * (APPROX; Tip the Scales makes the next Fire Breath instant).
 * APPROX list: all ally-attribution coefficients and proc rates; the
 * Duplicate window flattened to a 12s player buff (echo 40%, Ebon Might
 * pulse x1.75, Upheaval/Eruption x1.25); Command Squadron flattened to 3
 * scheduled Dracthyr strikes inside the Breath of Eons window; Mass
 * Eruption/Bombardments flattened to a single-target amp + attributed ally
 * hit with a flat Wingleader cooldown refund; Melt Armor as a flat 10%
 * damage-taken debuff; Time Skip flattened to an instant 15s refund on both
 * empower cooldowns; Blistering Scales and Unravel unmodeled. Damage in SP
 * units.
 */

const EM_PULSE = 0.75         // APPROX: allies' extra damage per second
const DUPLICATE_EM_MULT = 1.75 // Duplicate rank 3: Ebon Might grants 75% more
const PRESCIENCE_PULSE = 0.15 // APPROX: per stack, every 3s
const FATE_MIRROR_AMP = 3     // S2 4pc: Prescience echoes tripled after Upheaval
const ERUPTION_COEFF = 1.2
const MASS_ERUPTION_MULT = 1.4 // Mass Eruption-empowered Eruption
const BOMBARDMENT_COEFF = 0.6  // ally Bombardments per Mass Eruption (attributed)
const WINGLEADER_CDR = 3       // Breath of Eons refund per Mass Eruption (ST)
const FB_DIRECT = 1.3
const FB_TICK = 0.3           // every 2s over 24s
const UPHEAVAL_COEFF = 2.6    // incl. the Reverberations dot, flattened
const AZ_COEFF = 0.7          // Azure Strike, the Scalecommander ST filler
const LF_COEFF = 0.95
const DEEP_BREATH_COEFF = 1.8
const DUPLICATE_ECHO = 0.4    // Duplicate copies empower/Eruption casts
const DUPLICATE_CAST_MULT = 1.25 // Upheaval/Eruption while Duplicate is active
const MELT_ARMOR_MULT = 1.1
const BOE_PCT = 0.35          // APPROX: detonation share of banked damage
const SQUADRON_COEFF = 0.5    // Command Squadron Dracthyr strike, x3 per Breath
const EB_BASE_CHANCE = 0.15   // + crit chance, per filler cast

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

function duplicateUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'duplicate') > 0
}

/** Empower casts load Mass Eruption and are echoed by Duplicate. */
function onEmpowerCast(s: SimAPI, id: string, coeff: number) {
  s.applyAura('player', 'mass_eruption', { stacks: 1 })
  if (duplicateUp(s)) augDamage(s, 'Duplicate', coeff * DUPLICATE_ECHO)
}

export const augmentationScalecommander: SpecConfig = {
  name: 'Augmentation Evoker',
  specId: 'evoker-augmentation',
  specIcon: 'classicon_evoker_augmentation',
  buildId: 'scalecommander',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/evoker/augmentation/rotation-cooldowns-pve-dps',
    buildName: 'Raid Single Target — Scalecommander (Method; ~4% behind Chronowarden)',
    heroTalent: 'Scalecommander',
    // published verbatim on method.gg/guides/augmentation-evoker/talents
    // ("Raid Single Target (Scalecommander)")
    talentString: 'CEcBAAAAAAAAAAAAAAAAAAAAAMMzMbjZmxyMYmlZMzMmBAAAAAAAAzMMmBjpGzMzAAAAgZMjxMzyYmBmZzYwCsMGGbDgZQshxAzMAG',
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
      // allies' buffed damage, attributed (see header); stronger under Duplicate
      tick: {
        interval: 1, hasted: false,
        onTick: s => augDamage(s, 'Allies (Ebon Might)', EM_PULSE * (duplicateUp(s) ? DUPLICATE_EM_MULT : 1)),
      },
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
    // Apex: a Duplicate fights alongside you after Breath of Eons (flattened window)
    { id: 'duplicate', name: 'Duplicate', icon: 'ability_evoker_breathofeons', duration: 12 },
    // Scalecommander: empower casts load Mass Eruption for the next Eruption
    { id: 'mass_eruption', name: 'Mass Eruption', icon: 'ability_evoker_eruption', duration: 30, maxStacks: 2 },
    {
      id: 'fire_breath_dot', name: 'Fire Breath', icon: 'ability_evoker_firebreath', duration: 24, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => augDamage(s, 'fire_breath_dot', FB_TICK) },
    },
    {
      id: 'melt_armor', name: 'Melt Armor', icon: 'inv_ability_scalecommanderevoker_bombardments',
      duration: 12, debuff: true,
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
      displayName: (s) => (s.stacks('player', 'mass_eruption') > 0 ? 'Mass Eruption' : 'Eruption'),
      displayStacks: (s) => s.stacks('player', 'mass_eruption'),
      onResolve: (s) => {
        if (s.stacks('player', 'essence_burst') > 0) s.consumeStack('player', 'essence_burst')
        let coeff = ERUPTION_COEFF
        if (duplicateUp(s)) coeff *= DUPLICATE_CAST_MULT
        if (s.stacks('player', 'mass_eruption') > 0) {
          s.consumeStack('player', 'mass_eruption')
          coeff *= MASS_ERUPTION_MULT
          // Bombardments: allies' strikes triggered by the Mass Eruption (attributed)
          augDamage(s, 'Bombardments (allies)', BOMBARDMENT_COEFF)
          // Wingleader: each Mass Eruption target refunds Breath of Eons cooldown
          s.reduceCooldown('breath_of_eons', WINGLEADER_CDR)
        }
        augDamage(s, 'eruption', coeff)
        if (duplicateUp(s)) augDamage(s, 'Duplicate', coeff * DUPLICATE_ECHO)
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
        onEmpowerCast(s, 'fire_breath', FB_DIRECT)
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
        const coeff = UPHEAVAL_COEFF * (duplicateUp(s) ? DUPLICATE_CAST_MULT : 1)
        augDamage(s, 'upheaval', coeff)
        extendEbonMight(s, 2)
        s.applyAura('player', 'fate_mirror_amp') // S2 4pc window
        onEmpowerCast(s, 'upheaval', coeff)
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
      cooldown: 120,
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
      },
    },
    {
      id: 'breath_of_eons',
      name: 'Breath of Eons',
      icon: 'ability_evoker_breathofeons',
      spellId: 403631,
      cooldown: 120,
      onResolve: (s) => {
        s.applyAura('target', 'breath_of_eons')
        // Scalecommander: the flight shatters armor and leaves a Duplicate behind
        s.applyAura('target', 'melt_armor')
        s.applyAura('player', 'duplicate')
        // Command Squadron: two Dracthyr strafe the target during the flight,
        // their strikes banking into the Breath (APPROX: 3 staggered strikes)
        for (let i = 1; i <= 3; i++) {
          s.schedule(s.time + i * 1.5, () => augDamage(s, 'Dracthyr (Command Squadron)', SQUADRON_COEFF))
        }
      },
    },
    {
      id: 'deep_breath',
      name: 'Deep Breath',
      icon: 'ability_evoker_deepbreath',
      spellId: 357210,
      cooldown: 60,
      onResolve: (s) => augDamage(s, 'deep_breath', DEEP_BREATH_COEFF),
    },
    {
      id: 'azure_strike',
      name: 'Azure Strike',
      icon: 'ability_evoker_azurestrike',
      spellId: 362969,
      onResolve: (s) => {
        augDamage(s, 'azure_strike', AZ_COEFF)
        if (s.rng('essence_burst') < EB_BASE_CHANCE + s.stats.critChance) {
          s.applyAura('player', 'essence_burst', { stacks: 1 })
        }
      },
    },
    {
      id: 'living_flame',
      name: 'Living Flame',
      icon: 'ability_evoker_livingflame',
      spellId: 361469,
      castTime: 2.25,
      onResolve: (s) => {
        augDamage(s, 'living_flame', LF_COEFF)
        if (s.rng('essence_burst') < EB_BASE_CHANCE + s.stats.critChance) {
          s.applyAura('player', 'essence_burst', { stacks: 1 })
        }
      },
    },
  ],

  actionBar: [
    'ebon_might', 'eruption', 'fire_breath', 'upheaval', 'prescience',
    'tip_the_scales', 'time_skip', 'breath_of_eons', 'deep_breath',
    'azure_strike', 'living_flame',
  ],

  damageMult: (s, _spellId, _tags) => (s.auraRemains('target', 'melt_armor') > 0 ? MELT_ARMOR_MULT : 1),

  glows: (s, id) => {
    switch (id) {
      case 'ebon_might': return s.auraRemains('player', 'ebon_might') < 4 && s.cooldownRemains('ebon_might') === 0
      case 'eruption': return s.stacks('player', 'essence_burst') > 0 || s.stacks('player', 'mass_eruption') > 0
      case 'breath_of_eons': return s.cooldownRemains('breath_of_eons') === 0 && s.auraRemains('player', 'ebon_might') > 0
      case 'fire_breath': return s.auraRemains('player', 'tip_the_scales') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'ebon_might', text: 'The spec: refresh Ebon Might at <4s remaining — never let it drop', when: s => s.cooldownRemains('ebon_might') === 0 && s.auraRemains('player', 'ebon_might') < 4 },
    { abilityId: 'breath_of_eons', text: 'On cooldown, inside Ebon Might — Duplicate + Melt Armor + Dracthyr squadron', when: s => s.cooldownRemains('breath_of_eons') === 0 && s.auraRemains('player', 'ebon_might') > 0 },
    { abilityId: 'deep_breath', text: 'On cooldown (Scalecommander makes it a real cooldown again)', when: s => s.cooldownRemains('deep_breath') === 0 },
    { abilityId: 'prescience', text: 'On cooldown — never sit at 2 charges (S2 4pc feeds it)', when: s => s.chargesOf('prescience') === 2 || (s.chargesOf('prescience') > 0 && s.stacks('player', 'prescience_buff') < 2) },
    { abilityId: 'tip_the_scales', text: 'Pair with Fire Breath for an instant empower', when: s => s.cooldownRemains('tip_the_scales') === 0 && s.cooldownRemains('fire_breath') === 0 },
    { abilityId: 'fire_breath', text: 'On cooldown — dot, extends Ebon Might 2s, loads Mass Eruption', when: s => s.cooldownRemains('fire_breath') === 0 },
    { abilityId: 'upheaval', text: 'On cooldown (30s with 2pc) — extends Ebon Might, loads Mass Eruption', when: s => s.cooldownRemains('upheaval') === 0 },
    { abilityId: 'time_skip', text: 'When both empowers are on cooldown — fast-forwards them 15s', when: s => s.cooldownRemains('time_skip') === 0 && s.cooldownRemains('fire_breath') > 0 && s.cooldownRemains('upheaval') > 0 },
    { abilityId: 'eruption', text: 'Inside Ebon Might with Essence Burst or 3+ Essence — Mass Eruptions trigger Bombardments and refund Breath of Eons' },
    { abilityId: 'azure_strike', text: 'Filler — the better single-target builder for Scalecommander (Living Flame while stationary AoE)' },
  ],

  policy: (s) => {
    const emUp = s.auraRemains('player', 'ebon_might') > 0
    const eb = s.stacks('player', 'essence_burst')

    if (s.cooldownRemains('ebon_might') === 0 && s.auraRemains('player', 'ebon_might') < 4) return 'ebon_might'
    if (s.cooldownRemains('breath_of_eons') === 0 && emUp) return 'breath_of_eons'
    if (s.cooldownRemains('deep_breath') === 0) return 'deep_breath'
    if (s.chargesOf('prescience') === 2 || (s.chargesOf('prescience') > 0 && s.stacks('player', 'prescience_buff') < 2)) return 'prescience'
    if (s.cooldownRemains('tip_the_scales') === 0 && s.cooldownRemains('fire_breath') === 0) return 'tip_the_scales'
    if (s.cooldownRemains('fire_breath') === 0) return 'fire_breath'
    if (s.cooldownRemains('upheaval') === 0) return 'upheaval'
    if (s.cooldownRemains('time_skip') === 0 && s.cooldownRemains('fire_breath') > 0 && s.cooldownRemains('upheaval') > 0) return 'time_skip'
    if ((emUp && (eb > 0 || s.insanity >= 3)) || eb >= 2) return 'eruption'
    return 'azure_strike'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const empowers = ['fire_breath', 'upheaval']
    const fillers = ['azure_strike', 'living_flame', 'eruption']
    const buffs = ['prescience', 'ebon_might']
    const burst = ['breath_of_eons', 'deep_breath']
    const sets = [empowers, fillers, buffs, burst]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
