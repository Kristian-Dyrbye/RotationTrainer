import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Survival Hunter — patch 12.1.0 (Midnight, Season 2), Pack Leader raid ST
 * Mongoose Bite build (Icy Veins default). Built from the simc `midnight`
 * APL/source and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Focus, 100 cap, 5/s hasted passive regen (0.5s
 * granularity); Kill Command and Flanking Strike generate on top.
 * Talent assumptions: Mongoose Bite over Raptor Strike, Vipers Venom-style
 * Serpent Sting application folded into Mongoose Bite, Pack Leader boars on
 * Kill Command, Apex: Apex Predator 3/3 (Mongoose Bite at 5 Fury extends
 * Coordinated Assault 1s, 5 times).
 * Mongoose Fury is a fixed 14s window (stacks never refresh it — modeled
 * exactly). Wildfire Bomb burn is scheduled pulses, not a DoT aura.
 * S2 tier: 2pc Wildfire Bomb +25% (folded into the coefficients); 4pc Fury
 * of the Eagle ticks refund 0.5s of Wildfire Bomb cooldown each.
 * APPROX-flagged: auto-attack cadence, boar proc rate, FotE per-stack bonus.
 * Damage in AP units.
 */

const AUTO_COEFF = 0.46       // APPROX: 2h melee
const AUTO_SWING = 2.6
const KC_COEFF = 1.25
const KC_FOCUS = 15
const MB_COEFF = 1.35
const MB_PER_FURY = 0.15
const SS_TICK = 0.36
const BOMB_IMPACT = 1.35      // incl. S2 2pc +25%
const BOMB_BURN = 0.26        // 5 pulses over 5s
const FLANK_COEFF = 1.65
const FLANK_FOCUS = 15
const FOTE_TICK = 0.50        // 6 ticks
const FOTE_PER_FURY = 0.10
const CA_MULT = 1.20
const BOAR_HIT = 0.35         // Pack Leader: 3 hits
const BOAR_CHANCE = 0.25      // APPROX: per Kill Command

/** Mongoose Fury: fixed 14s window — adding stacks never refreshes it */
function addMongooseStack(s: SimAPI) {
  const mf = s.aura('player', 'mongoose_fury')
  if (mf) mf.stacks = Math.min(5, mf.stacks + 1)
  else s.applyAura('player', 'mongoose_fury', { stacks: 1 })
}

/** Pack Leader: Kill Command can send a boar charging through */
function boars(s: SimAPI) {
  for (let i = 0; i < 3; i++) {
    s.schedule(s.time + 0.5 + i * 0.4, () => s.damage('Pack Boar', BOAR_HIT))
  }
}

export const survivalHunter: SpecConfig = {
  name: 'Survival Hunter',
  specId: 'hunter-survival',
  specIcon: 'ability_hunter_camouflage',
  resourceName: 'Focus',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      s.schedule(s.time + AUTO_SWING * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.3, swing)
    const regen = () => {
      s.gain(2.5 / s.hasteMult(), 'focus_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
  },

  auras: [
    { id: 'mongoose_fury', name: 'Mongoose Fury', icon: 'ability_hunter_mongoosebite', duration: 14, maxStacks: 5 },
    { id: 'coordinated_assault', name: 'Coordinated Assault', icon: 'inv_coordinatedassault', duration: 20 },
    {
      id: 'serpent_sting', name: 'Serpent Sting', icon: 'spell_nature_corrosivebreath', duration: 18, pandemic: true, debuff: true,
      tick: { interval: 3, hasted: true, onTick: s => s.damage('serpent_sting', SS_TICK) },
    },
  ],

  abilities: [
    {
      id: 'kill_command',
      name: 'Kill Command',
      icon: 'ability_hunter_killcommand',
      spellId: 259489,
      cooldown: 8,
      charges: 2,
      onResolve: (s) => {
        s.damage('kill_command', KC_COEFF)
        s.gain(KC_FOCUS, 'kill_command')
        if (s.rng('pack_boar') < BOAR_CHANCE) boars(s)
      },
    },
    {
      id: 'mongoose_bite',
      name: 'Mongoose Bite',
      icon: 'ability_hunter_mongoosebite',
      spellId: 259387,
      cost: 30,
      onResolve: (s) => {
        const fury = s.stacks('player', 'mongoose_fury')
        s.damage('mongoose_bite', MB_COEFF * (1 + MB_PER_FURY * fury))
        s.applyAura('target', 'serpent_sting') // Vipers Venom folded in
        // Apex: Apex Predator — at 5 Fury, extend Coordinated Assault 1s, 5×
        if (fury === 5) {
          const ca = s.aura('player', 'coordinated_assault')
          if (ca && (ca.data.ext ?? 0) < 5) {
            ca.data.ext = (ca.data.ext ?? 0) + 1
            s.extendAura('player', 'coordinated_assault', 1)
          }
        }
        addMongooseStack(s)
      },
    },
    {
      id: 'wildfire_bomb',
      name: 'Wildfire Bomb',
      icon: 'inv_misc_bomb_05',
      spellId: 259495,
      cooldown: 18,
      onResolve: (s) => {
        s.damage('wildfire_bomb', BOMB_IMPACT)
        // burn: scheduled pulses, not a DoT aura
        for (let i = 1; i <= 5; i++) {
          s.schedule(s.time + i, () => s.damage('Wildfire Burn', BOMB_BURN, { canCrit: false }))
        }
      },
    },
    {
      id: 'flanking_strike',
      name: 'Flanking Strike',
      icon: 'ability_hunter_invigeration',
      spellId: 269751,
      cooldown: 30,
      onResolve: (s) => {
        s.damage('flanking_strike', FLANK_COEFF)
        s.gain(FLANK_FOCUS, 'flanking_strike')
      },
    },
    {
      id: 'fury_of_the_eagle',
      name: 'Fury of the Eagle',
      icon: 'inv_polearm_2h_artifacteagle_d_01',
      spellId: 203415,
      cooldown: 45,
      channel: {
        duration: 3,
        ticks: 6,
        hasted: true,
        onTick: (s) => {
          const fury = s.stacks('player', 'mongoose_fury')
          s.damage('fury_of_the_eagle', FOTE_TICK * (1 + FOTE_PER_FURY * fury))
          s.reduceCooldown('wildfire_bomb', 0.5) // S2 4pc
        },
      },
      onResolve: () => {},
    },
    {
      id: 'coordinated_assault',
      name: 'Coordinated Assault',
      icon: 'inv_coordinatedassault',
      spellId: 360952,
      cooldown: 120,
      onResolve: (s) => s.applyAura('player', 'coordinated_assault'),
    },
  ],

  actionBar: [
    'mongoose_bite', 'kill_command', 'wildfire_bomb', 'flanking_strike',
    'fury_of_the_eagle', 'coordinated_assault',
  ],

  damageMult: (s) => (s.auraRemains('player', 'coordinated_assault') > 0 ? CA_MULT : 1),

  glows: (s, id) => {
    switch (id) {
      case 'kill_command': return s.chargesOf('kill_command') === 2
      case 'mongoose_bite': return s.stacks('player', 'mongoose_fury') >= 3
      case 'fury_of_the_eagle': return s.cooldownRemains('fury_of_the_eagle') === 0 && s.stacks('player', 'mongoose_fury') >= 3
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'coordinated_assault', text: 'On cooldown (Mongoose Bites at 5 Fury extend it — Apex)', when: s => s.cooldownRemains('coordinated_assault') === 0 },
    { abilityId: 'wildfire_bomb', text: 'On cooldown', when: s => s.cooldownRemains('wildfire_bomb') === 0 },
    { abilityId: 'flanking_strike', text: 'On cooldown when it won’t overcap Focus', when: s => s.cooldownRemains('flanking_strike') === 0 },
    { abilityId: 'fury_of_the_eagle', text: 'At 3+ Mongoose Fury stacks', when: s => s.cooldownRemains('fury_of_the_eagle') === 0 && s.stacks('player', 'mongoose_fury') >= 3 },
    { abilityId: 'kill_command', text: 'Never sit at 2 charges; use to build Focus below ~70', when: s => s.chargesOf('kill_command') === 2 },
    { abilityId: 'mongoose_bite', text: 'Spend 30+ Focus — stack the 14s Fury window (Serpent Sting rides along)' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Fury of the Eagle
    const focus = s.insanity
    const fury = s.stacks('player', 'mongoose_fury')

    if (s.cooldownRemains('coordinated_assault') === 0) return 'coordinated_assault'
    if (s.cooldownRemains('wildfire_bomb') === 0) return 'wildfire_bomb'
    if (s.cooldownRemains('flanking_strike') === 0 && focus <= 80) return 'flanking_strike'
    if (s.cooldownRemains('fury_of_the_eagle') === 0 && fury >= 3) return 'fury_of_the_eagle'
    if (s.chargesOf('kill_command') === 2) return 'kill_command'
    if (s.chargesOf('kill_command') > 0 && focus <= 70) return 'kill_command'
    if (focus >= 30) return 'mongoose_bite'
    return null // pool for the next bite
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['kill_command', 'flanking_strike']
    const strikes = ['mongoose_bite', 'kill_command']
    const sets = [builders, strikes]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
