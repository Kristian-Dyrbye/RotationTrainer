import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Beast Mastery Hunter — patch 12.1.0 (Midnight, Season 2), Pack Leader raid
 * ST build (Icy Veins default). Built from the simc `midnight` APL/source and
 * Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Focus, 100 cap, 5/s hasted passive regen (0.5s granularity)
 * plus 20 Focus over the Barbed Shot bleed. Pet is a damage stream: a hasted
 * melee loop whose speed scales with Frenzy stacks, Kill Command / Dire Beast
 * hits, and Call of the Wild pulses.
 * Talent assumptions: Pack Leader, Scent of Blood-style double Barbed charges,
 * Killer Cobra folded into Cobra Shot's Kill Command refund,
 * Apex: Packmother's Call 3/3 (every 4th Kill Command calls a Dire Beast and
 * grants a Frenzy stack).
 * S2 tier: 2pc Kill Command +15% (folded into the coefficient); 4pc Cobra
 * Shot refunds an extra 0.5s of Kill Command cooldown (folded into the 1.5s
 * refund). APPROX-flagged: pet swing timer/coefficients, Barbed recharge
 * modeled flat 10s (12s hasted in game), Frenzy as swing-speed only.
 * Damage in AP units.
 */

const AUTO_SHOT = 0.18       // APPROX ranged auto
const WILD_CALL_CHANCE = 0.30 // APPROX: per auto crit
const PET_MELEE = 0.52        // APPROX pet swing
const PET_SWING = 2.0
const FRENZY_SPEED = 0.30     // per stack, 3 stacks
const KC_COEFF = 2.4          // incl. S2 2pc +15%
const BARBED_DIRECT = 0.52
const BARBED_TICK = 0.40
const COBRA_COEFF = 0.85
const COTW_PULSE = 0.70       // beast pulse every 2s for 20s
const DIRE_BEAST_HIT = 0.45   // 4 hits over 6s
const BW_MULT = 1.25

/** Apex: Packmother's Call — every 4th Kill Command calls a Dire Beast */
function direBeast(s: SimAPI) {
  for (let i = 0; i < 4; i++) {
    s.schedule(s.time + 0.8 + i * 1.6, () => s.damage('Dire Beast', DIRE_BEAST_HIT))
  }
  s.applyAura('player', 'frenzy', { stacks: 1 })
}

export const bmHunter: SpecConfig = {
  name: 'Beast Mastery Hunter',
  specId: 'hunter-beastmastery',
  specIcon: 'ability_hunter_bestialdiscipline',
  resourceName: 'Focus',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    // ranged autos: hasted; crits trigger Wild Call (Barbed Shot recharge refund)
    const autoShot = () => {
      s.damage('Auto Shot', AUTO_SHOT)
      if (s.rng('auto_crit') < s.stats.critChance && s.rng('wild_call') < WILD_CALL_CHANCE) {
        s.reduceCooldown('barbed_shot', 6) // Wild Call (APPROX)
      }
      s.schedule(s.time + 2.2 * s.hasteMult(), autoShot)
    }
    s.schedule(s.time + 0.3, autoShot)
    // pet melee: hasted, sped up further by Frenzy
    const swing = () => {
      const f = s.stacks('player', 'frenzy')
      s.damage('Pet Melee', PET_MELEE)
      s.schedule(s.time + (PET_SWING * s.hasteMult()) / (1 + FRENZY_SPEED * f), swing)
    }
    s.schedule(s.time + 0.5, swing)
    // passive Focus regen: 5/s base, hasted, 0.5s granularity
    const regen = () => {
      s.gain(2.5 / s.hasteMult(), 'focus_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
  },

  auras: [
    { id: 'frenzy', name: 'Frenzy', icon: 'ability_druid_mangle2', duration: 8, maxStacks: 3 },
    { id: 'bestial_wrath', name: 'Bestial Wrath', icon: 'ability_druid_ferociousbite', duration: 15 },
    {
      id: 'barbed_bleed', name: 'Barbed Shot', icon: 'ability_hunter_barbedshot', duration: 8, debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          s.damage('barbed_shot_bleed', BARBED_TICK)
          s.gain(5, 'barbed_shot') // 20 Focus over the bleed
        },
      },
    },
    {
      id: 'call_of_the_wild', name: 'Call of the Wild', icon: 'ability_hunter_callofthewild', duration: 20,
      tick: { interval: 2, hasted: false, onTick: s => s.damage('Wild Beast', COTW_PULSE) },
    },
  ],

  abilities: [
    {
      id: 'kill_command',
      name: 'Kill Command',
      icon: 'ability_hunter_killcommand',
      spellId: 34026,
      cooldown: 7.5,
      cost: 30,
      onResolve: (s) => {
        s.damage('kill_command', KC_COEFF)
        // Apex: Packmother's Call — every 4th Kill Command calls a Dire Beast
        s.data.kc_count = (s.data.kc_count ?? 0) + 1
        if (s.data.kc_count >= 4) {
          s.data.kc_count -= 4
          direBeast(s)
        }
      },
    },
    {
      id: 'barbed_shot',
      name: 'Barbed Shot',
      icon: 'ability_hunter_barbedshot',
      spellId: 217200,
      cooldown: 10, // APPROX: 12s recharge, hasted in game
      charges: 2,
      onResolve: (s) => {
        s.damage('barbed_shot', BARBED_DIRECT)
        s.applyAura('target', 'barbed_bleed')
        s.applyAura('player', 'frenzy', { stacks: 1 })
      },
    },
    {
      id: 'cobra_shot',
      name: 'Cobra Shot',
      icon: 'ability_hunter_cobrashot',
      spellId: 193455,
      cost: 35,
      onResolve: (s) => {
        s.damage('cobra_shot', COBRA_COEFF)
        s.reduceCooldown('kill_command', 1.5) // incl. S2 4pc +0.5s
      },
    },
    {
      id: 'bestial_wrath',
      name: 'Bestial Wrath',
      icon: 'ability_druid_ferociousbite',
      spellId: 19574,
      cooldown: 90,
      onResolve: (s) => {
        s.applyAura('player', 'bestial_wrath')
        s.applyAura('player', 'frenzy', { stacks: 1 }) // Pack Leader: the pack howls
      },
    },
    {
      id: 'call_of_the_wild',
      name: 'Call of the Wild',
      icon: 'ability_hunter_callofthewild',
      spellId: 359844,
      cooldown: 120,
      onResolve: (s) => {
        s.applyAura('player', 'call_of_the_wild')
        s.resetCooldown('barbed_shot') // CotW reloads Barbed Shot
      },
    },
  ],

  actionBar: [
    'kill_command', 'barbed_shot', 'cobra_shot', 'bestial_wrath', 'call_of_the_wild',
  ],

  damageMult: (s) => (s.auraRemains('player', 'bestial_wrath') > 0 ? BW_MULT : 1),

  glows: (s, id) => {
    switch (id) {
      case 'barbed_shot': return s.chargesOf('barbed_shot') === 2 || (s.auraRemains('player', 'frenzy') > 0 && s.auraRemains('player', 'frenzy') < 2)
      case 'kill_command': return s.cooldownRemains('kill_command') === 0 && s.insanity >= 30
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'bestial_wrath', text: 'On cooldown', when: s => s.cooldownRemains('bestial_wrath') === 0 },
    { abilityId: 'call_of_the_wild', text: 'On cooldown (reloads Barbed Shot)', when: s => s.cooldownRemains('call_of_the_wild') === 0 },
    { abilityId: 'barbed_shot', text: 'Never sit at 2 charges; never let Frenzy or the bleed drop', when: s => s.chargesOf('barbed_shot') === 2 },
    { abilityId: 'kill_command', text: 'On cooldown with 30+ Focus (every 4th calls a Dire Beast — Apex)', when: s => s.cooldownRemains('kill_command') === 0 },
    { abilityId: 'cobra_shot', text: 'Above ~60 Focus — refunds 1.5s of Kill Command' },
  ],

  policy: (s) => {
    const focus = s.insanity
    const bleed = s.auraRemains('target', 'barbed_bleed')
    const frenzy = s.auraRemains('player', 'frenzy')

    if (s.cooldownRemains('bestial_wrath') === 0) return 'bestial_wrath'
    if (s.cooldownRemains('call_of_the_wild') === 0) return 'call_of_the_wild'
    if (s.chargesOf('barbed_shot') === 2) return 'barbed_shot'
    if (s.chargesOf('barbed_shot') > 0 && (bleed < 2 || (frenzy > 0 && frenzy < 1.5))) return 'barbed_shot'
    if (s.cooldownRemains('kill_command') === 0 && focus >= 30) return 'kill_command'
    if (focus >= 60) return 'cobra_shot'
    return null // pool Focus for Kill Command
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const spenders = ['kill_command', 'cobra_shot']
    const cds = ['bestial_wrath', 'call_of_the_wild']
    const sets = [spenders, cds]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
