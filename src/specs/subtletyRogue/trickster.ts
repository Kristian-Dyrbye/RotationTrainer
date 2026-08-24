import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Subtlety Rogue — patch 12.1.0 (Midnight, Season 2), Trickster raid
 * single-target build (alternate to the default Deathstalker). Researched
 * 2026-08-24 against:
 * - Wowhead rotation guide: https://www.wowhead.com/guide/classes/rogue/subtlety/rotation-cooldowns-pve-dps
 * - Method playstyle (Trickster priority): https://www.method.gg/guides/subtlety-rogue/playstyle-and-rotation
 * - Icy Veins rotation/builds: https://www.icy-veins.com/wow/subtlety-rogue-pve-dps-rotation-cooldowns-abilities
 *
 * Midnight pruning kept: Symbols of Death and Rupture are REMOVED from
 * Subtlety; finishers at 6+ CP, max 7. Trickster layer per Method/Wowhead:
 * Unseen Blade strikes ride on Backstab/Shadowstrike (internal cooldown,
 * relaxed during Shadow Dance by the tree's proc talents), each strike
 * dealing bonus damage, Fazing the target (+8% damage taken from you) and
 * stacking Escalating Blade — at 4 stacks the next Eviscerate becomes
 * Coup de Grace, hitting as if it spent 5 extra combo points and granting
 * 5 stacks of Flawless Form (finisher damage per stack). Priority:
 * Goremaw's Bite whenever ready; Shadow Dance with 6+ CP and Secret
 * Technique ready (also to avoid capping charges / during Shadow Blades);
 * Shadow Blades during Dance; inside Dance spend at 6+ CP preferring
 * Secret Technique > Coup de Grace > Eviscerate; consume Coup de Grace
 * whenever it is ready; Shadowstrike in Dance, Backstab outside.
 *
 * Shared mechanics copied from the base spec.ts: Energy 100, 10/s hasted
 * regen; Combo Points as a 7-stack player aura with the Shadow Techniques
 * trickle; Goremaw's Bite redesign (hit + 14s bleed pulses + 20% finisher
 * echo); S2 tier 2pc Backstab -10 energy/+100% (folded) and 4pc Lingering
 * Darkness after Shadow Blades (+25% Eviscerate).
 * APPROX list: Unseen Blade modeled as a timer (12s ICD, 4s inside Shadow
 * Dance — the tree's extra-proc talents folded), Flawless Form +2%
 * finisher damage per stack, Fazed folded to +8% damage dealt, auto/clone
 * timings, proc rates. Coup de Grace shown on the Eviscerate button
 * (displayName/displayIcon transform).
 * No talent import string: for 12.1 Icy Veins publishes Trickster Sub
 * loadouts only for Mythic+/Delves (not raid), and Method publishes only
 * Deathstalker loadouts — none matches this raid ST build. Damage in AP
 * units.
 */

const AUTO_COEFF = 0.24
const BS_COEFF = 1.90          // 0.95 base, incl. S2 2pc +100%
const SHST_COEFF = 1.90
const EVIS_PER_CP = 0.65
const ST_PER_CP = 0.50         // Secret Technique lead hit
const ST_CLONE_PER_CP = 0.25   // 4 clone hits
const GB_HIT = 1.30            // Goremaw's Bite impact
const GB_BLEED = 0.40          // 7 pulses over 14s (APPROX)
const GB_ECHO = 0.20           // finisher damage echoed as Shadow
const UB_COEFF = 0.70          // Unseen Blade bonus strike (APPROX)
const COUP_EXTRA_CP = 5        // Coup de Grace: as if 5 extra CP
const FLAWLESS_PER_STACK = 0.02
const FAZED_MULT = 1.08        // +8% damage from you (folded to damage dealt)
const UB_ICD = 12              // APPROX: base internal cooldown
const UB_ICD_DANCE = 4         // APPROX: extra-proc talents during Dance folded
const LINGERING_MULT = 1.25    // S2 4pc Eviscerate amp
const SHADOW_BLADES_MULT = 1.2

function addCP(s: SimAPI, n: number) {
  const blades = s.auraRemains('player', 'shadow_blades') > 0 ? 1 : 0
  s.applyAura('player', 'combo_points', { stacks: n + blades })
}

function spendCP(s: SimAPI): number {
  const cp = s.stacks('player', 'combo_points')
  s.removeAura('player', 'combo_points')
  return cp
}

function danceUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'shadow_dance') > 0
}

function coupReady(s: SimAPI): boolean {
  return s.stacks('player', 'escalating_blade') >= 4
}

/** Unseen Blade: rides on builders, timer-gated (relaxed inside Dance) */
function tryUnseenBlade(s: SimAPI) {
  const icd = danceUp(s) ? UB_ICD_DANCE : UB_ICD
  const last = s.data.unseenBladeAt ?? -99
  if (s.time - last < icd) return
  s.data.unseenBladeAt = s.time
  s.damage('Unseen Blade', UB_COEFF, { tags: ['shadow'] })
  s.applyAura('player', 'escalating_blade', { stacks: 1 })
  s.applyAura('target', 'fazed')
}

/** finisher damage, echoed as Shadow while Goremaw's Bite runs */
function finishHit(s: SimAPI, spellId: string, coeff: number) {
  const flawless = 1 + FLAWLESS_PER_STACK * s.stacks('player', 'flawless_form')
  s.damage(spellId, coeff * flawless)
  if (s.auraRemains('player', 'goremaws_bite') > 0) {
    s.damage("Goremaw's Bite", GB_ECHO * coeff * flawless, { tags: ['shadow'] })
  }
}

export const subtletyTrickster: SpecConfig = {
  name: 'Subtlety Rogue',
  specId: 'rogue-subtlety',
  specIcon: 'ability_stealth',
  buildId: 'trickster',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/rogue/subtlety/rotation-cooldowns-pve-dps',
    buildName: 'Single-Target (Raid) — Trickster',
    heroTalent: 'Trickster',
    // no published raid-ST Trickster import string for 12.1 (Icy Veins'
    // Trickster loadouts are Mythic+/Delves; Method publishes Deathstalker)
    retrieved: '2026-08-24',
  },
  resourceName: 'Energy',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    const regen = () => {
      s.gain(5 / s.hasteMult(), 'energy_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
    // dual-wield autos; Shadow Techniques CP trickle folded (APPROX)
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      if (s.rng('shadow_techniques') < 0.25) addCP(s, 1)
      s.schedule(s.time + 1.3 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'combo_points', name: 'Combo Points', icon: 'ability_rogue_eviscerate', duration: Infinity, maxStacks: 7 },
    { id: 'shadow_dance', name: 'Shadow Dance', icon: 'ability_rogue_shadowdance', duration: 8 },
    {
      id: 'shadow_blades', name: 'Shadow Blades', icon: 'inv_knife_1h_grimbatolraid_d_03', duration: 16,
      // S2 4pc: Lingering Darkness strengthens the back half of the cycle
      onExpire: s => s.applyAura('player', 'lingering_darkness'),
    },
    { id: 'lingering_darkness', name: 'Lingering Darkness', icon: 'spell_shadow_twilight', duration: 12 },
    { id: 'goremaws_bite', name: "Goremaw's Bite", icon: 'inv_knife_1h_artifactfangs_d_01', duration: 14 },
    { id: 'escalating_blade', name: 'Escalating Blade', icon: 'inv_ability_tricksterrogue_coupdegrace', duration: 30, maxStacks: 4 },
    { id: 'flawless_form', name: 'Flawless Form', icon: 'ability_rogue_masterofsubtlety', duration: 15, maxStacks: 10 },
    { id: 'fazed', name: 'Fazed', icon: 'ability_rogue_dirtydeeds', duration: 10, debuff: true },
  ],

  abilities: [
    {
      id: 'backstab',
      name: 'Backstab',
      icon: 'ability_backstab',
      spellId: 53,
      cost: 25, // 35 base, S2 2pc -10
      onResolve: (s) => {
        s.damage('backstab', BS_COEFF)
        addCP(s, 1)
        tryUnseenBlade(s)
      },
    },
    {
      id: 'shadowstrike',
      name: 'Shadowstrike',
      icon: 'ability_rogue_shadowstrike',
      spellId: 185438,
      cost: 40,
      usable: (s) => (danceUp(s) ? true : 'requires Shadow Dance'),
      onResolve: (s) => {
        s.damage('shadowstrike', SHST_COEFF)
        addCP(s, 2)
        tryUnseenBlade(s)
      },
    },
    {
      id: 'eviscerate',
      name: 'Eviscerate',
      icon: 'ability_rogue_eviscerate',
      spellId: 196819,
      cost: 35,
      displayName: (s) => (coupReady(s) ? 'Coup de Grace' : 'Eviscerate'),
      displayIcon: (s) => (coupReady(s) ? 'inv_ability_tricksterrogue_coupdegrace' : 'ability_rogue_eviscerate'),
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const coup = coupReady(s)
        const cp = spendCP(s)
        let mult = 1
        if (s.auraRemains('player', 'lingering_darkness') > 0) mult *= LINGERING_MULT
        const effective = coup ? cp + COUP_EXTRA_CP : cp
        finishHit(s, coup ? 'coup_de_grace' : 'eviscerate', EVIS_PER_CP * effective * mult)
        if (coup) {
          // Coup de Grace consumes the stacks, Fazes the target and grants
          // 5 stacks of Flawless Form
          s.removeAura('player', 'escalating_blade')
          s.applyAura('target', 'fazed')
          s.applyAura('player', 'flawless_form', { stacks: 5 })
        }
      },
    },
    {
      id: 'secret_technique',
      name: 'Secret Technique',
      icon: 'ability_rogue_sinistercalling',
      spellId: 280719,
      cost: 30,
      cooldown: 60,
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const cp = spendCP(s)
        finishHit(s, 'secret_technique', ST_PER_CP * cp)
        for (let i = 1; i <= 4; i++) {
          s.schedule(s.time + 0.3 * i, () => s.damage('secret_technique', ST_CLONE_PER_CP * cp))
        }
      },
    },
    {
      id: 'goremaws_bite',
      name: "Goremaw's Bite",
      icon: 'inv_knife_1h_artifactfangs_d_01',
      spellId: 426591,
      cost: 25,
      cooldown: 45,
      onResolve: (s) => {
        s.damage("Goremaw's Bite", GB_HIT)
        addCP(s, 3)
        s.applyAura('player', 'goremaws_bite')
        // 14s bleed modeled as scheduled pulses (not a tracked debuff)
        for (let i = 1; i <= 7; i++) {
          s.schedule(s.time + i * 2, () => s.damage("Goremaw's Bite", GB_BLEED, { tags: ['bleed'] }))
        }
      },
    },
    {
      id: 'shadow_dance',
      name: 'Shadow Dance',
      icon: 'ability_rogue_shadowdance',
      spellId: 185313,
      cooldown: 60,
      charges: 2,
      offGcd: true,
      usable: (s) => (danceUp(s) ? 'already dancing' : true),
      onResolve: (s) => s.applyAura('player', 'shadow_dance'),
    },
    {
      id: 'shadow_blades',
      name: 'Shadow Blades',
      icon: 'inv_knife_1h_grimbatolraid_d_03',
      spellId: 121471,
      cooldown: 90,
      offGcd: true,
      onResolve: (s) => s.applyAura('player', 'shadow_blades'),
    },
  ],

  actionBar: [
    'backstab', 'shadowstrike', 'eviscerate', 'secret_technique',
    'goremaws_bite', 'shadow_dance', 'shadow_blades',
  ],

  damageMult: (s) => {
    let m = s.auraRemains('player', 'shadow_blades') > 0 ? SHADOW_BLADES_MULT : 1
    if (s.auraRemains('target', 'fazed') > 0) m *= FAZED_MULT
    return m
  },

  glows: (s, id) => {
    const cp = s.stacks('player', 'combo_points')
    switch (id) {
      case 'goremaws_bite': return s.cooldownRemains('goremaws_bite') === 0
      case 'shadow_dance': return !danceUp(s) && s.chargesOf('shadow_dance') > 0 && cp >= 6
        && (s.cooldownRemains('secret_technique') === 0
          || s.auraRemains('player', 'shadow_blades') > 0
          || s.chargesOf('shadow_dance') === 2)
      case 'shadow_blades': return danceUp(s) && s.cooldownRemains('shadow_blades') === 0
      case 'shadowstrike': return danceUp(s)
      case 'eviscerate': return coupReady(s) || cp >= 6
      case 'secret_technique': return danceUp(s) && cp >= 6 && s.cooldownRemains('secret_technique') === 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'goremaws_bite', text: 'Whenever ready — right before your other cooldowns', when: s => s.cooldownRemains('goremaws_bite') === 0 },
    { abilityId: 'shadow_dance', text: 'At 6+ CP with Secret Technique ready, during Shadow Blades, or to avoid capping charges', when: s => !danceUp(s) && s.chargesOf('shadow_dance') > 0 && s.stacks('player', 'combo_points') >= 6 && (s.cooldownRemains('secret_technique') === 0 || s.auraRemains('player', 'shadow_blades') > 0 || s.chargesOf('shadow_dance') === 2) },
    { abilityId: 'shadow_blades', text: 'Off-GCD, during a Shadow Dance window (every ~90s)', when: s => danceUp(s) && s.cooldownRemains('shadow_blades') === 0 },
    { abilityId: 'secret_technique', text: 'Inside Shadow Dance at 6+ CP — first in the finisher order', when: s => danceUp(s) && s.stacks('player', 'combo_points') >= 6 && s.cooldownRemains('secret_technique') === 0 },
    { abilityId: 'eviscerate', text: 'Consume Coup de Grace whenever ready (6+ CP) — hits as if 5 extra CP, grants 5 Flawless Form', label: 'Coup de Grace', icon: 'inv_ability_tricksterrogue_coupdegrace', when: s => coupReady(s) && s.stacks('player', 'combo_points') >= 6 },
    { abilityId: 'eviscerate', text: 'At 6+ CP', when: s => s.stacks('player', 'combo_points') >= 6 },
    { abilityId: 'shadowstrike', text: 'Builder inside Shadow Dance — Unseen Blades stack Escalating Blade' },
    { abilityId: 'backstab', text: 'Builder outside Dance — cheap with the 2pc, never cap energy' },
  ],

  policy: (s) => {
    const cp = s.stacks('player', 'combo_points')
    const dance = danceUp(s)
    const bladesUp = s.auraRemains('player', 'shadow_blades') > 0
    const secReady = s.cooldownRemains('secret_technique') === 0

    if (s.cooldownRemains('goremaws_bite') === 0) return 'goremaws_bite'
    if (!dance && s.chargesOf('shadow_dance') > 0 && cp >= 6
      && (secReady || bladesUp || s.chargesOf('shadow_dance') === 2)) return 'shadow_dance'
    if (dance && s.cooldownRemains('shadow_blades') === 0) return 'shadow_blades'
    if (dance && cp >= 6 && secReady) return 'secret_technique'
    if (coupReady(s) && cp >= 6) return 'eviscerate'
    if (cp >= 6) return 'eviscerate'
    if (dance) return 'shadowstrike'
    return 'backstab'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const finishers = ['eviscerate', 'secret_technique']
    const builders = ['backstab', 'shadowstrike']
    const sets = [finishers, builders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
