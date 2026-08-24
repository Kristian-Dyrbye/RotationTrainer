import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Marksmanship Hunter — patch 12.1.0 (Midnight, Season 2), Sentinel raid
 * single-target build (petless — MM lost its pet in the big rework and 12.1
 * reworked it again). Verified against live guides 2026-08-24:
 * - Wowhead: https://www.wowhead.com/guide/classes/hunter/marksmanship/rotation-cooldowns-pve-dps
 *   ("Sentinel is recommended for all content"; Dark Ranger not recommended)
 * - Icy Veins: https://www.icy-veins.com/wow/marksmanship-hunter-pve-dps-rotation-cooldowns-abilities
 *   and https://www.icy-veins.com/wow/marksmanship-hunter-pve-dps-easy-mode
 * - Method: https://www.method.gg/guides/marksmanship-hunter/playstyle-and-rotation
 *   (talent string from https://www.method.gg/guides/marksmanship-hunter/talents,
 *   "Sentinel Single Target / Raid (Recommended)")
 *
 * 12.1 rework highlights (corroborated by the guides above):
 * - Explosive Shot returns as the top-priority rotational ability: a short
 *   burn that bursts every couple of seconds; Unstable Trigger lets you cast
 *   it twice back to back (modeled as 2 charges; bursts as scheduled pulses).
 * - Precise Shots procs after every Aimed Shot AND Rapid Fire, and must be
 *   spent (Arcane Shot) before the next Aimed Shot — Rapid Fire is exempt.
 * - Spotter's Mark: consuming Precise Shots can grant a mark that buffs your
 *   next Aimed Shot (~90% proc rate inside Trueshot per Icy Veins).
 * - Deathblow procs (guaranteed from Rapid Fire) arm a free Kill Shot.
 * - Sentinel: Moonlight Chakram — one throw per Trueshot window, used once
 *   Aimed Shot availability runs dry.
 * - S2 tier (folded in): 2pc = Explosive Shot lasts 1s longer, +20% damage
 *   (one extra burst); 4pc = Aimed/Rapid Fire +5% damage, and every Explosive
 *   Shot burst reduces Aimed Shot and Rapid Fire cooldowns by 0.5s.
 *
 * APPROX (not published / simplified): all coefficients (AP units), Explosive
 * Shot recharge (30s), Trueshot as +30% haste for 15s (Bullseye fight-end
 * hold not modeled), Deathblow chance per Aimed Shot, Spotter's Mark proc
 * rates, Volley on a 45s cooldown with Tactical Reload ignored, Moonlight
 * Chakram cooldown aligned to Trueshot's 90s.
 */

const AUTO_SHOT = 0.15        // APPROX ranged auto
const AIMED_COEFF = 2.4       // incl. S2 4pc +5%
const SPOTTER_MULT = 1.30     // APPROX: Spotter's Mark Aimed Shot bonus
const ARCANE_COEFF = 0.9
const PRECISE_MULT = 1.75
const STEADY_COEFF = 0.5
const STEADY_FOCUS = 10
const RF_TICK = 0.40          // 7 ticks, incl. S2 4pc +5%
const EXPLO_IMPACT = 0.55     // incl. S2 2pc +20%
const EXPLO_BURST = 0.50      // per burst, incl. S2 2pc +20%
const EXPLO_BURSTS = 5        // 4 base + 1 from the S2 2pc extra second
const KILL_SHOT_COEFF = 2.2
const VOLLEY_PULSE = 0.35     // 6 pulses over 6s
const CHAKRAM_HIT = 1.0       // + 3 bounces at half value
const TRUESHOT_HASTE = 0.30   // APPROX
const DEATHBLOW_CHANCE = 0.15 // APPROX: per Aimed Shot (Rapid Fire guarantees one)
const SPOTTER_CHANCE = 0.35   // APPROX; ~0.9 inside Trueshot per Icy Veins

function deathblowUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'deathblow') > 0
}

function trueshotUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'trueshot') > 0
}

/** consuming Precise Shots can grant a Spotter's Mark for the next Aimed Shot */
function rollSpotterMark(s: SimAPI) {
  const chance = trueshotUp(s) ? 0.9 : SPOTTER_CHANCE
  if (s.rng('spotters_mark') < chance) s.applyAura('player', 'spotters_mark')
}

export const mmHunter: SpecConfig = {
  name: 'Marksmanship Hunter',
  specId: 'hunter-marksmanship',
  specIcon: 'ability_hunter_focusedaim',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/hunter/marksmanship/rotation-cooldowns-pve-dps',
    buildName: 'Sentinel Single Target / Raid (Method build)',
    heroTalent: 'Sentinel',
    talentString: 'C4PAAAAAAAAAAAAAAAAAAAAAAwCMwMGzYZAMD2AAAAAAAAAzYGzwMmZGzgx0MGM2WmZmZmZmZmFmZZwMAAg5BmZGDgZajhBYjZ2mxA',
    retrieved: '2026-08-24',
  },
  resourceName: 'Focus',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    // ranged autos (petless spec — no pet damage stream)
    const autoShot = () => {
      s.damage('Auto Shot', AUTO_SHOT)
      s.schedule(s.time + 2.4 * s.hasteMult(), autoShot)
    }
    s.schedule(s.time + 0.3, autoShot)
    // passive Focus regen: 5/s base, hasted, 0.5s granularity
    const regen = () => {
      s.gain(2.5 / s.hasteMult(), 'focus_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
  },

  auras: [
    { id: 'precise_shots', name: 'Precise Shots', icon: 'ability_hunter_focusedaim', duration: 15, maxStacks: 2 },
    { id: 'spotters_mark', name: "Spotter's Mark", icon: 'ability_hunter_mastermarksman', duration: 15 },
    { id: 'deathblow', name: 'Deathblow', icon: 'ability_hunter_assassinate', duration: 12 },
    { id: 'trueshot', name: 'Trueshot', icon: 'ability_trueshot', duration: 15 },
  ],

  abilities: [
    {
      id: 'explosive_shot',
      name: 'Explosive Shot',
      icon: 'ability_hunter_explosiveshot',
      spellId: 212431,
      cooldown: 30, // APPROX recharge
      charges: 2,   // Unstable Trigger: cast it twice back to back
      cost: 20,
      onResolve: (s) => {
        s.damage('explosive_shot', EXPLO_IMPACT)
        // burn bursts every second; S2 4pc: each burst refunds 0.5s of
        // Aimed Shot and Rapid Fire cooldown
        for (let i = 1; i <= EXPLO_BURSTS; i++) {
          s.schedule(s.time + i, () => {
            s.damage('Explosive Burst', EXPLO_BURST)
            s.reduceCooldown('aimed_shot', 0.5)
            s.reduceCooldown('rapid_fire', 0.5)
          })
        }
      },
    },
    {
      id: 'aimed_shot',
      name: 'Aimed Shot',
      icon: 'inv_spear_07',
      spellId: 19434,
      castTime: 2.5,
      cooldown: 12,
      charges: 2,
      cost: 35,
      onResolve: (s) => {
        let mult = 1
        if (s.auraRemains('player', 'spotters_mark') > 0) {
          s.removeAura('player', 'spotters_mark')
          mult = SPOTTER_MULT
        }
        s.damage('aimed_shot', AIMED_COEFF * mult)
        s.applyAura('player', 'precise_shots', { stacks: 2 })
        if (s.rng('deathblow') < DEATHBLOW_CHANCE) s.applyAura('player', 'deathblow')
      },
    },
    {
      id: 'arcane_shot',
      name: 'Arcane Shot',
      icon: 'ability_impalingbolt',
      spellId: 185358,
      cost: 40,
      onResolve: (s) => {
        let mult = 1
        if (s.stacks('player', 'precise_shots') > 0) {
          s.consumeStack('player', 'precise_shots')
          mult = PRECISE_MULT
          rollSpotterMark(s)
        }
        s.damage('arcane_shot', ARCANE_COEFF * mult)
      },
    },
    {
      id: 'rapid_fire',
      name: 'Rapid Fire',
      icon: 'ability_hunter_efficiency',
      spellId: 257044,
      cooldown: 20,
      channel: {
        duration: 2,
        ticks: 7,
        hasted: true,
        onTick: (s, i) => {
          s.damage('rapid_fire', RF_TICK)
          s.gain(1, 'rapid_fire')
          s.reduceCooldown('aimed_shot', 5 / 7) // 5s of Aimed recharge per channel
          if (i === 6) {
            s.applyAura('player', 'precise_shots', { stacks: 2 })
            s.applyAura('player', 'deathblow') // Rapid Fire guarantees a Deathblow
          }
        },
      },
      onResolve: () => {},
    },
    {
      id: 'kill_shot',
      name: 'Kill Shot',
      icon: 'ability_hunter_assassinate2',
      spellId: 53351,
      cooldown: 10,
      usable: (s) => (deathblowUp(s) ? true : 'needs a Deathblow proc (target above 80%)'),
      onResolve: (s) => {
        s.removeAura('player', 'deathblow')
        s.damage('kill_shot', KILL_SHOT_COEFF)
      },
    },
    {
      id: 'volley',
      name: 'Volley',
      icon: 'ability_hunter_rapidkilling',
      spellId: 260243,
      cooldown: 45,
      onResolve: (s) => {
        for (let i = 0; i < 6; i++) {
          s.schedule(s.time + i, () => s.damage('Volley', VOLLEY_PULSE))
        }
      },
    },
    {
      id: 'moonlight_chakram',
      name: 'Moonlight Chakram',
      icon: 'inv_glaive_1h_artifactazgalor_d_01',
      cooldown: 90, // one per Trueshot window (aligned to Trueshot's cooldown)
      usable: (s) => (trueshotUp(s) ? true : 'only during Trueshot'),
      onResolve: (s) => {
        s.damage('moonlight_chakram', CHAKRAM_HIT)
        for (let i = 1; i <= 3; i++) {
          s.schedule(s.time + i * 0.4, () => s.damage('moonlight_chakram', CHAKRAM_HIT * 0.5))
        }
      },
    },
    {
      id: 'steady_shot',
      name: 'Steady Shot',
      icon: 'ability_hunter_steadyshot',
      spellId: 56641,
      castTime: 1.75,
      onResolve: (s) => {
        s.damage('steady_shot', STEADY_COEFF)
        s.gain(STEADY_FOCUS, 'steady_shot')
      },
    },
    {
      id: 'trueshot',
      name: 'Trueshot',
      icon: 'ability_trueshot',
      spellId: 288613,
      cooldown: 90,
      onResolve: (s) => s.applyAura('player', 'trueshot'),
    },
  ],

  actionBar: [
    'explosive_shot', 'aimed_shot', 'arcane_shot', 'rapid_fire', 'kill_shot',
    'volley', 'moonlight_chakram', 'steady_shot', 'trueshot',
  ],

  hasteMod: (s) => (trueshotUp(s) ? TRUESHOT_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'kill_shot': return deathblowUp(s)
      case 'arcane_shot': return s.stacks('player', 'precise_shots') > 0
      case 'aimed_shot': return s.auraRemains('player', 'spotters_mark') > 0
      case 'moonlight_chakram': return trueshotUp(s) && s.cooldownRemains('moonlight_chakram') === 0
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'explosive_shot', text: 'On cooldown — cast both charges back to back (Unstable Trigger)', when: s => s.chargesOf('explosive_shot') > 0 },
    { abilityId: 'volley', text: 'On cooldown', when: s => s.cooldownRemains('volley') === 0 },
    { abilityId: 'trueshot', text: 'On cooldown', when: s => s.cooldownRemains('trueshot') === 0 },
    { abilityId: 'kill_shot', text: 'On a Deathblow proc (free — Rapid Fire guarantees one)', when: s => deathblowUp(s) && s.cooldownRemains('kill_shot') === 0 },
    { abilityId: 'arcane_shot', text: 'Spend Precise Shots before the next Aimed Shot', when: s => s.stacks('player', 'precise_shots') > 0 },
    { abilityId: 'rapid_fire', text: 'On cooldown — refunds Aimed Shot, procs Deathblow + Precise Shots', when: s => s.cooldownRemains('rapid_fire') === 0 },
    { abilityId: 'moonlight_chakram', text: 'Once per Trueshot, when Aimed Shot runs dry (Sentinel)', when: s => trueshotUp(s) && s.cooldownRemains('moonlight_chakram') === 0 },
    { abilityId: 'aimed_shot', text: 'Keep charges rolling — never with Precise Shots waiting' },
    { abilityId: 'arcane_shot', text: 'Dump above ~75 Focus' },
    { abilityId: 'steady_shot', text: 'Filler — builds Focus' },
  ],

  /**
   * Oracle — hand-translated from the Icy Veins 12.1 easy-mode order
   * (Explosive > Volley > Trueshot > Kill Shot > Arcane w/ Precise > Rapid
   * Fire > Chakram > Aimed > Steady), with Wowhead's Precise Shots rule:
   * never Aimed Shot while Precise Shots is unspent.
   */
  policy: (s) => {
    if (s.casting?.channel) return null // never clip Rapid Fire
    const focus = s.insanity
    const ps = s.stacks('player', 'precise_shots')

    if (s.chargesOf('explosive_shot') > 0 && focus >= 20) return 'explosive_shot'
    if (s.cooldownRemains('volley') === 0) return 'volley'
    if (s.cooldownRemains('trueshot') === 0) return 'trueshot'
    if (deathblowUp(s) && s.cooldownRemains('kill_shot') === 0) return 'kill_shot'
    if (ps > 0 && focus >= 40) return 'arcane_shot'
    if (s.cooldownRemains('rapid_fire') === 0) return 'rapid_fire'
    if (trueshotUp(s) && s.cooldownRemains('moonlight_chakram') === 0
      && (s.chargesOf('aimed_shot') === 0 || s.auraRemains('player', 'trueshot') < 5)) {
      return 'moonlight_chakram'
    }
    if (ps === 0 && s.chargesOf('aimed_shot') > 0 && focus >= 35) return 'aimed_shot'
    if (focus >= 75) return 'arcane_shot'
    return 'steady_shot'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const spenders = ['arcane_shot', 'aimed_shot']
    const fillers = ['steady_shot', 'arcane_shot']
    const sets = [spenders, fillers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
