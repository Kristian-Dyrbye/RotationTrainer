import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Subtlety Rogue — patch 12.1.0 (Midnight, Season 2), Deathstalker raid ST
 * build (Icy Veins default). Built from the simc `midnight` APL/source and
 * Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Energy 100, 10/s base regen (hasted); Combo Points as a
 * 5-stack player aura — 6/7-CP talents and Shadow Techniques trickle folded
 * (APPROX). Stealth openers skipped (dummy: combat starts in the open);
 * Shadow Dance is the only stealth window and gates Shadowstrike.
 * Talent assumptions: Deathstalker (simplified: Shadowstrike applies 3
 * Deathstalker's Mark stacks; each Eviscerate consumes one for a plasma hit;
 * consuming the last grants Darkest Night — next Eviscerate +50%),
 * Apex: Eternal Shadows 3/3 (finishers during Shadow Dance extend it 1s,
 * 3 times per Dance). S2 tier: 2pc Shadowstrike +25% folded into the
 * coefficient; 4pc finishers during Shadow Dance refund 3s of Secret
 * Technique cooldown. APPROX-flagged: auto cadence, clone timings,
 * Symbols energy refund. Damage in AP units.
 */

const AUTO_COEFF = 0.24
const BS_COEFF = 0.95
const SHST_COEFF = 1.90        // incl. S2 2pc +25%
const EVIS_PER_CP = 0.65
const RUPTURE_TICK = 0.48
const ST_PER_CP = 0.50         // Secret Technique lead hit
const ST_CLONE_PER_CP = 0.25   // 4 clone hits
const MARK_HIT = 0.85          // Deathstalker's Mark plasma bolt
const DARKEST_NIGHT_MULT = 1.5
const SYMBOLS_MULT = 1.15
const SHADOW_BLADES_MULT = 1.25

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

/** shared finisher hooks: Apex Dance extension + S2 4pc SecTec refund */
function onFinisher(s: SimAPI) {
  const dance = s.aura('player', 'shadow_dance')
  if (dance) {
    if ((dance.data.ext ?? 0) < 3) {
      dance.data.ext = (dance.data.ext ?? 0) + 1
      s.extendAura('player', 'shadow_dance', 1) // Apex: Eternal Shadows
    }
    s.reduceCooldown('secret_technique', 3) // S2 4pc
  }
}

export const subtletyRogue: SpecConfig = {
  name: 'Subtlety Rogue',
  specId: 'rogue-subtlety',
  specIcon: 'ability_stealth',
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
    { id: 'combo_points', name: 'Combo Points', icon: 'ability_rogue_eviscerate', duration: Infinity, maxStacks: 5 },
    { id: 'shadow_dance', name: 'Shadow Dance', icon: 'ability_rogue_shadowdance', duration: 8 },
    { id: 'symbols_of_death', name: 'Symbols of Death', icon: 'spell_shadow_rune', duration: 10 },
    { id: 'shadow_blades', name: 'Shadow Blades', icon: 'inv_knife_1h_grimbatolraid_d_03', duration: 16 },
    { id: 'darkest_night', name: 'Darkest Night', icon: 'inv_ability_deathstalkerrogue_darkestnight', duration: 20 },
    { id: 'deathstalkers_mark', name: "Deathstalker's Mark", icon: 'inv_ability_deathstalkerrogue_deathstalkersmark', duration: 60, maxStacks: 3, debuff: true },
    {
      id: 'rupture', name: 'Rupture', icon: 'ability_rogue_rupture', duration: 24, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('rupture', RUPTURE_TICK, { tags: ['bleed'] }) },
    },
  ],

  abilities: [
    {
      id: 'backstab',
      name: 'Backstab',
      icon: 'ability_backstab',
      spellId: 53,
      cost: 35,
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
        s.applyAura('target', 'deathstalkers_mark', { stacks: 3 })
      },
    },
    {
      id: 'rupture',
      name: 'Rupture',
      icon: 'ability_rogue_rupture',
      spellId: 1943,
      cost: 25,
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const cp = spendCP(s)
        s.applyAura('target', 'rupture', { duration: 4 + 4 * cp })
        onFinisher(s)
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
        const cp = spendCP(s)
        let mult = 1
        if (s.auraRemains('player', 'darkest_night') > 0) {
          s.removeAura('player', 'darkest_night')
          mult = DARKEST_NIGHT_MULT
        }
        s.damage('eviscerate', EVIS_PER_CP * cp * mult)
        // Deathstalker's Mark: consume a stack; last stack grants Darkest Night
        if (s.stacks('target', 'deathstalkers_mark') > 0) {
          const last = s.stacks('target', 'deathstalkers_mark') === 1
          s.consumeStack('target', 'deathstalkers_mark')
          s.damage("Deathstalker's Mark", MARK_HIT)
          if (last) s.applyAura('player', 'darkest_night')
        }
        onFinisher(s)
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
        s.damage('secret_technique', ST_PER_CP * cp)
        for (let i = 1; i <= 4; i++) {
          s.schedule(s.time + 0.3 * i, () => s.damage('secret_technique', ST_CLONE_PER_CP * cp))
        }
        onFinisher(s)
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
      id: 'symbols_of_death',
      name: 'Symbols of Death',
      icon: 'spell_shadow_rune',
      spellId: 212283,
      cooldown: 30,
      offGcd: true,
      onResolve: (s) => {
        s.applyAura('player', 'symbols_of_death')
        s.gain(30, 'symbols_of_death') // energy refund folded (APPROX)
      },
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
    'backstab', 'shadowstrike', 'eviscerate', 'rupture', 'secret_technique',
    'shadow_dance', 'symbols_of_death', 'shadow_blades',
  ],

  damageMult: (s) => {
    let m = 1
    if (s.auraRemains('player', 'symbols_of_death') > 0) m *= SYMBOLS_MULT
    if (s.auraRemains('player', 'shadow_blades') > 0) m *= SHADOW_BLADES_MULT
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'shadowstrike': return danceUp(s)
      case 'eviscerate': return s.stacks('player', 'combo_points') >= 5
      case 'secret_technique': return danceUp(s) && s.stacks('player', 'combo_points') >= 5 && s.cooldownRemains('secret_technique') === 0
      case 'rupture': return s.stacks('player', 'combo_points') >= 4 && s.auraRemains('target', 'rupture') < 7.2
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'rupture', text: 'Establish early, refresh at 4-5 CP in pandemic (<7.2s)', when: s => s.stacks('player', 'combo_points') >= 4 && s.auraRemains('target', 'rupture') < 7.2 },
    { abilityId: 'symbols_of_death', text: 'Off-GCD, on cooldown — refunds energy', when: s => s.cooldownRemains('symbols_of_death') === 0 },
    { abilityId: 'shadow_blades', text: 'Off-GCD, paired with Symbols', when: s => s.cooldownRemains('shadow_blades') === 0 },
    { abilityId: 'shadow_dance', text: 'With Symbols up, entering at low CP', when: s => s.chargesOf('shadow_dance') > 0 && s.auraRemains('player', 'shadow_dance') <= 0 },
    { abilityId: 'secret_technique', text: 'At 5 CP inside Shadow Dance', when: s => s.cooldownRemains('secret_technique') === 0 && s.auraRemains('player', 'shadow_dance') > 0 },
    { abilityId: 'eviscerate', text: 'At 5 CP — chains Deathstalker’s Mark into Darkest Night', when: s => s.stacks('player', 'combo_points') >= 5 },
    { abilityId: 'shadowstrike', text: 'Builder inside Shadow Dance (keeps 3 Marks loaded)' },
    { abilityId: 'backstab', text: 'Builder outside Dance — pool, never cap energy' },
  ],

  policy: (s) => {
    const cp = s.stacks('player', 'combo_points')
    const ruptureR = s.auraRemains('target', 'rupture')
    const dance = danceUp(s)
    const symbolsUp = s.auraRemains('player', 'symbols_of_death') > 0

    if (cp >= 1 && ruptureR <= 0) return 'rupture'
    if (cp >= 4 && ruptureR < 7.2) return 'rupture'
    if (s.cooldownRemains('symbols_of_death') === 0) return 'symbols_of_death'
    if (s.cooldownRemains('shadow_blades') === 0 && symbolsUp) return 'shadow_blades'
    if (s.chargesOf('shadow_dance') > 0 && !dance && symbolsUp && cp <= 3) return 'shadow_dance'
    if (cp >= 5) {
      if (dance && s.cooldownRemains('secret_technique') === 0) return 'secret_technique'
      return 'eviscerate'
    }
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
