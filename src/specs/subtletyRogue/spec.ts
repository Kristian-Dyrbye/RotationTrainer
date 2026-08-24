import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Subtlety Rogue — patch 12.1.0 (Midnight, Season 2), Deathstalker raid
 * single-target build. Verified 2026-08-24 against:
 * - Wowhead rotation guide: https://www.wowhead.com/guide/classes/rogue/subtlety/rotation-cooldowns-pve-dps
 * - Icy Veins rotation: https://www.icy-veins.com/wow/subtlety-rogue-pve-dps-rotation-cooldowns-abilities
 *   (talent string from https://www.icy-veins.com/wow/subtlety-rogue-pve-dps-spec-builds-talents)
 * - Method: https://www.method.gg/guides/subtlety-rogue/playstyle-and-rotation
 *
 * Midnight pruning modeled: Symbols of Death and Rupture were REMOVED from
 * the spec. Sub is now a 90-second spec — Shadow Blades plus two Shadow
 * Dances per cycle. Live priority: Goremaw's Bite whenever ready, right
 * before other cooldowns; Shadow Dance when Secret Technique is ready or
 * Shadow Blades is active (entering at 6+ or at 2 or fewer CP); Shadow
 * Blades during Dance; Eviscerate at 6+ CP with Darkest Night; Secret
 * Technique in Dance at 6+ CP; Eviscerate at 6+ CP; Shadowstrike in Dance,
 * Backstab outside. (Coup de Grace is the Trickster line — not in this
 * Deathstalker build.)
 *
 * Resource model: Energy 100, 10/s base regen (hasted); Combo Points as a
 * 7-stack player aura, finishers at 6+ — Shadow Techniques trickle folded
 * (APPROX). Stealth openers skipped (dummy: combat starts in the open);
 * Shadow Dance gates Shadowstrike. Deathstalker simplified: Shadowstrike
 * loads 3 Deathstalker's Mark stacks; each Eviscerate consumes one for a
 * plasma hit; the last grants Darkest Night — a 6+ CP Eviscerate consumes
 * it for +50% and 3 fresh Marks.
 * S2 tier: 2pc Backstab -10 energy and +100% damage (folded into cost and
 * coefficient); 4pc Lingering Darkness after Shadow Blades buffs
 * Eviscerate +25% (APPROX). Goremaw's Bite redesign: hit + 14s bleed
 * (scheduled pulses, not a tracked debuff) and 20% of finisher damage
 * echoed as Shadow while it runs.
 * APPROX-flagged: auto cadence, clone timings, proc rates, Goremaw's Bite
 * cooldown (45s), Lingering Darkness numbers. Damage in AP units.
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
const MARK_HIT = 0.85          // Deathstalker's Mark plasma bolt
const DARKEST_NIGHT_MULT = 1.5
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

/** finisher damage, echoed as Shadow while Goremaw's Bite runs */
function finishHit(s: SimAPI, spellId: string, coeff: number) {
  s.damage(spellId, coeff)
  if (s.auraRemains('player', 'goremaws_bite') > 0) {
    s.damage("Goremaw's Bite", GB_ECHO * coeff, { tags: ['shadow'] })
  }
}

export const subtletyRogue: SpecConfig = {
  name: 'Subtlety Rogue',
  specId: 'rogue-subtlety',
  specIcon: 'ability_stealth',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/rogue/subtlety/rotation-cooldowns-pve-dps',
    buildName: 'Single-Target (Raid)',
    heroTalent: 'Deathstalker',
    // Icy Veins "Single-Target - Deathstalker", 12.1
    talentString: 'CUQAAAAAAAAAAAAAAAAAAAAAAAgx2MAAAAAwsMGLTMbbjxMDDzMzMzw8AbzYGbbzMzMzMjBjZ2GAAAAGMmFzyADYBsMMBmFMDzMAzYA',
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
    { id: 'darkest_night', name: 'Darkest Night', icon: 'ability_rogue_envelopingshadows', duration: 30 },
    { id: 'deathstalkers_mark', name: "Deathstalker's Mark", icon: 'inv_ability_deathstalkerrogue_deathstalkersmark', duration: 60, maxStacks: 3, debuff: true },
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
        if (s.stacks('target', 'deathstalkers_mark') === 0) {
          s.applyAura('target', 'deathstalkers_mark', { stacks: 3 })
        }
      },
    },
    {
      id: 'eviscerate',
      name: 'Eviscerate',
      icon: 'ability_rogue_eviscerate',
      spellId: 196819,
      cost: 35,
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const dn = s.auraRemains('player', 'darkest_night') > 0
        const cp = spendCP(s)
        const bigFinish = dn && cp >= 6
        let mult = 1
        if (bigFinish) {
          // Darkest Night: 6+ CP Eviscerate consumes it — big hit + 3 Marks
          s.removeAura('player', 'darkest_night')
          mult *= DARKEST_NIGHT_MULT
          s.applyAura('target', 'deathstalkers_mark', { stacks: 3 })
        }
        if (s.auraRemains('player', 'lingering_darkness') > 0) mult *= LINGERING_MULT
        finishHit(s, 'eviscerate', EVIS_PER_CP * cp * mult)
        // Deathstalker's Mark: consume a stack for a plasma hit; the last
        // stack grants Darkest Night
        if (!bigFinish && s.stacks('target', 'deathstalkers_mark') > 0) {
          const last = s.stacks('target', 'deathstalkers_mark') === 1
          s.consumeStack('target', 'deathstalkers_mark')
          s.damage("Deathstalker's Mark", MARK_HIT)
          if (last) s.applyAura('player', 'darkest_night')
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

  damageMult: (s) => (s.auraRemains('player', 'shadow_blades') > 0 ? SHADOW_BLADES_MULT : 1),

  glows: (s, id) => {
    const cp = s.stacks('player', 'combo_points')
    switch (id) {
      case 'goremaws_bite': return s.cooldownRemains('goremaws_bite') === 0
      case 'shadow_dance': return !danceUp(s) && s.chargesOf('shadow_dance') > 0
        && (s.cooldownRemains('secret_technique') === 0 || s.auraRemains('player', 'shadow_blades') > 0)
        && (cp >= 6 || cp <= 2)
      case 'shadow_blades': return danceUp(s) && s.cooldownRemains('shadow_blades') === 0
      case 'shadowstrike': return danceUp(s)
      case 'eviscerate': return cp >= 6
      case 'secret_technique': return danceUp(s) && cp >= 6 && s.cooldownRemains('secret_technique') === 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'goremaws_bite', text: 'Whenever ready — right before your other cooldowns', when: s => s.cooldownRemains('goremaws_bite') === 0 },
    { abilityId: 'shadow_dance', text: 'With Secret Technique ready or Shadow Blades active — enter at 6+ or ≤2 CP', when: s => !danceUp(s) && s.chargesOf('shadow_dance') > 0 && (s.cooldownRemains('secret_technique') === 0 || s.auraRemains('player', 'shadow_blades') > 0) && (s.stacks('player', 'combo_points') >= 6 || s.stacks('player', 'combo_points') <= 2) },
    { abilityId: 'shadow_blades', text: 'Off-GCD, during a Shadow Dance window (every ~90s)', when: s => danceUp(s) && s.cooldownRemains('shadow_blades') === 0 },
    { abilityId: 'eviscerate', text: 'At 6+ CP with Darkest Night — consumes it for +50% and 3 Marks', label: 'Eviscerate (Darkest Night)', when: s => s.stacks('player', 'combo_points') >= 6 && s.auraRemains('player', 'darkest_night') > 0 },
    { abilityId: 'secret_technique', text: 'Inside Shadow Dance at 6+ CP', when: s => danceUp(s) && s.stacks('player', 'combo_points') >= 6 && s.cooldownRemains('secret_technique') === 0 },
    { abilityId: 'eviscerate', text: 'At 6+ CP — chains Deathstalker’s Mark into Darkest Night', when: s => s.stacks('player', 'combo_points') >= 6 },
    { abilityId: 'shadowstrike', text: 'Builder inside Shadow Dance (keeps 3 Marks loaded)' },
    { abilityId: 'backstab', text: 'Builder outside Dance — cheap with the 2pc, never cap energy' },
  ],

  policy: (s) => {
    const cp = s.stacks('player', 'combo_points')
    const dance = danceUp(s)
    const bladesUp = s.auraRemains('player', 'shadow_blades') > 0
    const secReady = s.cooldownRemains('secret_technique') === 0
    const dn = s.auraRemains('player', 'darkest_night') > 0

    if (s.cooldownRemains('goremaws_bite') === 0) return 'goremaws_bite'
    if (!dance && s.chargesOf('shadow_dance') > 0 && (secReady || bladesUp)
      && (cp >= 6 || cp <= 2)) return 'shadow_dance'
    if (dance && s.cooldownRemains('shadow_blades') === 0) return 'shadow_blades'
    if (cp >= 6 && dn) return 'eviscerate'
    if (cp >= 6 && dance && secReady) return 'secret_technique'
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
