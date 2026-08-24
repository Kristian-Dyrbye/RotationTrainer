import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Feral Druid — patch 12.1.0 (Midnight, Season 2), Druid of the Claw raid
 * ST build (Icy Veins default). Built from the simc `midnight` APL/source
 * and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Energy (max 100, ~10/s hasted regen). Combo Points are
 * modeled as a 5-stack player aura. Bleed snapshotting is NOT modeled —
 * Tiger's Fury is a flat global amp instead (APPROX, the big v1
 * simplification for this spec). Rip duration does not scale with combo
 * points (finishers require 5 CP, APPROX). Feral Frenzy's bleed is
 * modeled as scheduled pulses, not a refreshable dot.
 * Talent assumptions: Apex Predator's Craving (free 5-CP Bite proc, fed by
 * bleed ticks — S2 4pc folded into the rate), Druid of the Claw (Tiger's
 * Fury grants Ravage, transforming the next Ferocious Bite),
 * Apex: Alpha of the Wilds 3/3 (Feral Frenzy resets Tiger's Fury).
 * S2 tier: 2pc Rake bleed +15% (folded into the coefficient).
 * APPROX-flagged: proc rates, auto cadence. Damage in AP units.
 */

const AUTO_COEFF = 0.30
const SHRED_COEFF = 0.80
const RAKE_HIT = 0.30
const RAKE_TICK = 0.35        // every 3s over 15s, incl. S2 2pc
const RIP_TICK = 0.40         // every 2s over 24s
const BITE_COEFF = 1.6        // at 5 CP
const RAVAGE_COEFF = 2.4      // Druid of the Claw empowered Bite
const FRENZY_HIT = 0.22       // 5 hits
const FRENZY_BLEED_PULSE = 0.18 // 6 pulses over 6s (scheduled, not a dot)
const TF_MULT = 1.15
const BERSERK_MULT = 1.15
const CC_CHANCE = 0.15        // APPROX: Omen of Clarity per auto
const APEX_CHANCE = 0.06      // APPROX: Apex Predator per bleed tick

function cp(s: SimAPI): number {
  return s.stacks('player', 'combo_points')
}

/** Primal Fury: combo-generating crits award an extra point (scales with crit) */
function addBuilderCP(s: SimAPI) {
  addCP(s, s.rng('primal_fury') < s.stats.critChance ? 2 : 1)
}

function addCP(s: SimAPI, n: number) {
  s.applyAura('player', 'combo_points', { stacks: n })
}

function rollApex(s: SimAPI) {
  if (s.rng('apex_predator') < APEX_CHANCE) s.applyAura('player', 'apex_predator')
}

function ravageReady(s: SimAPI): boolean {
  return s.auraRemains('player', 'ravage_ready') > 0
}

export const feralDruid: SpecConfig = {
  name: 'Feral Druid',
  specId: 'druid-feral',
  specIcon: 'ability_druid_catform',
  resourceName: 'Energy',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    // energy regen: ~10/s, scaled by haste
    const regen = () => {
      s.gain(5 / s.hasteMult(), 'energy_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
    // cat autos: 1s swing timer, hasted; Omen of Clarity rides along
    const swing = () => {
      s.damage('Cat Melee', AUTO_COEFF)
      if (s.rng('omen_of_clarity') < CC_CHANCE) s.applyAura('player', 'clearcasting')
      s.schedule(s.time + 1.0 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'combo_points', name: 'Combo Points', icon: 'ability_druid_catform', duration: Infinity, maxStacks: 5 },
    { id: 'clearcasting', name: 'Clearcasting', icon: 'spell_shadow_manaburn', duration: 15 },
    { id: 'apex_predator', name: "Apex Predator's Craving", icon: 'ability_druid_primaltenacity', duration: 15 },
    { id: 'ravage_ready', name: 'Ravage', icon: 'ability_druid_rake', duration: 20 },
    { id: 'tigers_fury', name: "Tiger's Fury", icon: 'ability_mount_jungletiger', duration: 10 },
    { id: 'berserk', name: 'Berserk', icon: 'ability_druid_berserk', duration: 15 },
    {
      id: 'rake_dot', name: 'Rake', icon: 'ability_druid_disembowel', duration: 15, pandemic: true, debuff: true,
      tick: {
        interval: 3, hasted: true,
        onTick: (s) => {
          s.damage('rake_dot', RAKE_TICK, { tags: ['bleed'] })
          rollApex(s)
        },
      },
    },
    {
      id: 'rip_dot', name: 'Rip', icon: 'ability_ghoulfrenzy', duration: 24, pandemic: true, debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          s.damage('rip_dot', RIP_TICK, { tags: ['bleed'] })
          rollApex(s)
        },
      },
    },
  ],

  abilities: [
    {
      id: 'shred',
      name: 'Shred',
      icon: 'spell_shadow_vampiricaura',
      spellId: 5221,
      cost: 40,
      costMod: (s) => {
        if (s.auraRemains('player', 'clearcasting') > 0) return 0
        return s.auraRemains('player', 'berserk') > 0 ? 20 : 40
      },
      onResolve: (s) => {
        if (s.auraRemains('player', 'clearcasting') > 0) s.removeAura('player', 'clearcasting')
        s.damage('shred', SHRED_COEFF)
        addBuilderCP(s)
      },
    },
    {
      id: 'rake',
      name: 'Rake',
      icon: 'ability_druid_disembowel',
      spellId: 1822,
      cost: 35,
      costMod: (s) => (s.auraRemains('player', 'berserk') > 0 ? 17 : 35),
      onResolve: (s) => {
        s.damage('rake', RAKE_HIT)
        s.applyAura('target', 'rake_dot')
        addBuilderCP(s)
      },
    },
    {
      id: 'rip',
      name: 'Rip',
      icon: 'ability_ghoulfrenzy',
      spellId: 1079,
      cost: 20,
      usable: (s) => (cp(s) === 5 ? true : 'requires 5 combo points'),
      onResolve: (s) => {
        s.applyAura('target', 'rip_dot')
        s.removeAura('player', 'combo_points')
      },
    },
    {
      // One button, as in game: Druid of the Claw's Ravage proc transforms it.
      id: 'ferocious_bite',
      name: 'Ferocious Bite',
      icon: 'ability_druid_ferociousbite',
      spellId: 22568,
      cost: 25,
      costMod: (s) => (s.auraRemains('player', 'apex_predator') > 0 ? 0 : 25),
      displayName: (s) => (ravageReady(s) ? 'Ravage' : 'Ferocious Bite'),
      displayIcon: (s) => (ravageReady(s) ? 'ability_druid_rake' : 'ability_druid_ferociousbite'),
      usable: (s) => (cp(s) === 5 || s.auraRemains('player', 'apex_predator') > 0
        ? true
        : 'requires 5 combo points'),
      onResolve: (s) => {
        const apex = s.auraRemains('player', 'apex_predator') > 0
        if (ravageReady(s)) {
          s.removeAura('player', 'ravage_ready')
          s.damage('Ravage', RAVAGE_COEFF)
        } else {
          s.damage('ferocious_bite', BITE_COEFF)
        }
        if (apex) {
          s.removeAura('player', 'apex_predator') // free, keeps combo points
        } else {
          s.removeAura('player', 'combo_points')
        }
      },
    },
    {
      id: 'tigers_fury',
      name: "Tiger's Fury",
      icon: 'ability_mount_jungletiger',
      spellId: 5217,
      cooldown: 30,
      offGcd: true,
      onResolve: (s) => {
        s.gain(60, 'tigers_fury')
        s.applyAura('player', 'tigers_fury')
        s.applyAura('player', 'ravage_ready') // Druid of the Claw
      },
    },
    {
      id: 'feral_frenzy',
      name: 'Feral Frenzy',
      icon: 'ability_druid_rake',
      spellId: 274837,
      cost: 25,
      cooldown: 45,
      onResolve: (s) => {
        addCP(s, 5)
        for (let i = 0; i < 5; i++) {
          s.schedule(s.time + 0.2 * i, () => s.damage('feral_frenzy', FRENZY_HIT))
        }
        // its bleed: short burst, modeled as scheduled pulses
        for (let i = 1; i <= 6; i++) {
          s.schedule(s.time + i, () => s.damage('Feral Frenzy (bleed)', FRENZY_BLEED_PULSE, { tags: ['bleed'] }))
        }
        s.resetCooldown('tigers_fury') // Apex: Alpha of the Wilds
      },
    },
    {
      id: 'berserk',
      name: 'Berserk',
      icon: 'ability_druid_berserk',
      spellId: 106951,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => {
        s.applyAura('player', 'berserk')
        s.gain(30, 'berserk')
      },
    },
  ],

  actionBar: [
    'shred', 'rake', 'rip', 'ferocious_bite',
    'tigers_fury', 'feral_frenzy', 'berserk',
  ],

  damageMult: (s) => {
    let m = 1
    if (s.auraRemains('player', 'tigers_fury') > 0) m *= TF_MULT
    if (s.auraRemains('player', 'berserk') > 0) m *= BERSERK_MULT
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'ferocious_bite': return s.auraRemains('player', 'apex_predator') > 0 || ravageReady(s)
      case 'shred': return s.auraRemains('player', 'clearcasting') > 0
      case 'rip': return cp(s) === 5 && s.auraRemains('target', 'rip_dot') < 7.2
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'tigers_fury', text: 'Off-GCD, on cooldown when below ~40 Energy', when: s => s.cooldownRemains('tigers_fury') === 0 },
    { abilityId: 'berserk', text: 'Off-GCD, on cooldown', when: s => s.cooldownRemains('berserk') === 0 },
    { abilityId: 'ferocious_bite', text: "Apex Predator's Craving / Ravage procs — free, keeps your combo points", when: s => s.auraRemains('player', 'apex_predator') > 0 },
    { abilityId: 'rip', text: 'At 5 CP when Rip is in the pandemic window (<7.2s)', when: s => cp(s) === 5 && s.auraRemains('target', 'rip_dot') < 7.2 },
    { abilityId: 'ferocious_bite', text: 'At 5 CP otherwise', when: s => cp(s) === 5 },
    { abilityId: 'rake', text: 'Keep the Rake bleed in pandemic (<4.5s)' },
    { abilityId: 'feral_frenzy', text: 'On cooldown at 0 CP — 5 CP + resets Tiger’s Fury (Apex)', when: s => s.cooldownRemains('feral_frenzy') === 0 },
    { abilityId: 'shred', text: 'Builder / Clearcasting spender — don’t cap Energy' },
  ],

  policy: (s) => {
    const energy = s.insanity
    const c = cp(s)
    const ripRemains = s.auraRemains('target', 'rip_dot')
    const rakeRemains = s.auraRemains('target', 'rake_dot')

    if (s.cooldownRemains('tigers_fury') === 0 && energy < 40) return 'tigers_fury'
    if (s.cooldownRemains('berserk') === 0) return 'berserk'
    if (s.auraRemains('player', 'apex_predator') > 0) return 'ferocious_bite'
    if (c === 5) {
      if (ripRemains < 24 * 0.3) return 'rip'
      return 'ferocious_bite'
    }
    if (rakeRemains < 15 * 0.3) return 'rake'
    if (s.cooldownRemains('feral_frenzy') === 0 && c === 0) return 'feral_frenzy'
    if (s.auraRemains('player', 'clearcasting') > 0) return 'shred'
    return 'shred'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['shred', 'rake']
    const finishers = ['rip', 'ferocious_bite']
    const sets = [builders, finishers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
