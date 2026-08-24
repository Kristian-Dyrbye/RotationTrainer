import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Marksmanship Hunter — patch 12.1.0 (Midnight, Season 2), Dark Ranger raid
 * single-target build (alternate to the default Sentinel build in spec.ts).
 *
 * CAVEAT: Wowhead's 12.1 guide states "Sentinel is recommended for all
 * content" and that Dark Ranger will NOT be recommended; this variant is
 * modeled for players who want to run it anyway, from the rotations Method
 * and Icy Veins publish for it. Verified against live guides 2026-08-24:
 * - Wowhead: https://www.wowhead.com/guide/classes/hunter/marksmanship/rotation-cooldowns-pve-dps
 * - Icy Veins: https://www.icy-veins.com/wow/marksmanship-hunter-pve-dps-rotation-cooldowns-abilities
 * - Method: https://www.method.gg/guides/marksmanship-hunter/playstyle-and-rotation
 *   (talent string from https://www.method.gg/guides/marksmanship-hunter/talents,
 *   "Dark Ranger Single Target / Raid")
 *
 * Shared Midnight class facts (same as spec.ts): petless spec; Explosive
 * Shot is the top rotational priority (2 charges via Unstable Trigger);
 * Precise Shots procs after every Aimed Shot and Rapid Fire and must be
 * spent before the next Aimed Shot; Spotter's Mark procs off spending
 * Precise Shots (~90% inside Trueshot); Rapid Fire guarantees a Deathblow;
 * S2 tier = longer/harder-hitting Explosive Shot (2pc) and Explosive bursts
 * refunding Aimed/Rapid Fire cooldown (4pc).
 *
 * Dark Ranger differences (Method priority list, corroborated by Icy Veins):
 * - Black Arrow replaces Kill Shot AND Arcane Shot: it is the Precise Shots
 *   spender (top priority: "Cast Black Arrow to consume Precise Shots"), is
 *   free and boosted on a Deathblow proc, and leaves a shadow DoT behind.
 * - Activating Trueshot also grants a free Black Arrow proc (Deathblow).
 * - Trueshot transforms into Wailing Arrow for one cast per window; Wailing
 *   Arrow grants another Black Arrow proc, so it is cast when no proc is
 *   already up (Icy Veins: "cast both when we do not already have a proc").
 * - No Moonlight Chakram (that is the Sentinel capstone).
 *
 * APPROX (not published / simplified): all coefficients (AP units), Black
 * Arrow DoT (12s shadow tick), Deathblow-boosted Black Arrow multiplier,
 * Explosive Shot recharge (30s), Trueshot as +30% haste for 15s, Deathblow
 * chance per Aimed Shot, Spotter's Mark proc rates, Volley on a 45s
 * cooldown, Wailing Arrow cooldown aligned to Trueshot's 90s.
 */

const AUTO_SHOT = 0.15        // APPROX ranged auto (Bleak Arrows: shadow)
const AIMED_COEFF = 2.4       // incl. S2 4pc +5%
const SPOTTER_MULT = 1.30     // APPROX: Spotter's Mark Aimed Shot bonus
const BLACK_ARROW_COEFF = 1.0 // APPROX: Arcane Shot-slot base hit
const PRECISE_MULT = 1.75
const DEATHBLOW_MULT = 2.2    // APPROX: Deathblow-armed Black Arrow (Kill Shot slot)
const BLACK_ARROW_TICK = 0.22 // APPROX shadow DoT tick
const STEADY_COEFF = 0.5
const STEADY_FOCUS = 10
const RF_TICK = 0.40          // 7 ticks, incl. S2 4pc +5%
const EXPLO_IMPACT = 0.55     // incl. S2 2pc +20%
const EXPLO_BURST = 0.50      // per burst, incl. S2 2pc +20%
const EXPLO_BURSTS = 5        // 4 base + 1 from the S2 2pc extra second
const VOLLEY_PULSE = 0.35     // 6 pulses over 6s
const WAILING_COEFF = 2.4     // APPROX
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

export const mmDarkRanger: SpecConfig = {
  name: 'Marksmanship Hunter',
  specId: 'hunter-marksmanship',
  specIcon: 'ability_hunter_focusedaim',
  buildId: 'dark-ranger',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/hunter/marksmanship/rotation-cooldowns-pve-dps',
    buildName: 'Dark Ranger Single Target / Raid (Method build — Wowhead recommends Sentinel instead)',
    heroTalent: 'Dark Ranger',
    talentString: 'C4PAAAAAAAAAAAAAAAAAAAAAAYzsMwAmgZYbAzCAAAAAAAAYGzYGmxMzYGMmmxgx2yMzMzMzMzswMLDGAAg5BmZGzMzACDDwGzsNjB',
    retrieved: '2026-08-24',
  },
  resourceName: 'Focus',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    // ranged autos (petless spec; Bleak Arrows — shadow)
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
    {
      id: 'black_arrow_dot',
      name: 'Black Arrow',
      icon: 'ability_theblackarrow',
      duration: 12, // APPROX
      pandemic: true,
      debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => s.damage('black_arrow_dot', BLACK_ARROW_TICK),
      },
    },
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
      id: 'black_arrow',
      name: 'Black Arrow',
      icon: 'ability_theblackarrow',
      spellId: 466930,
      cost: 40,
      costMod: (s) => (deathblowUp(s) ? 0 : 40), // Deathblow procs are free
      onResolve: (s) => {
        let mult = 1
        if (deathblowUp(s)) {
          // the Kill Shot slot: a free, boosted Black Arrow
          s.removeAura('player', 'deathblow')
          mult = DEATHBLOW_MULT
        } else if (s.stacks('player', 'precise_shots') > 0) {
          // the Arcane Shot slot: consumes Precise Shots
          s.consumeStack('player', 'precise_shots')
          mult = PRECISE_MULT
          rollSpotterMark(s)
        }
        s.damage('black_arrow', BLACK_ARROW_COEFF * mult)
        s.applyAura('target', 'black_arrow_dot')
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
      id: 'wailing_arrow',
      name: 'Wailing Arrow',
      icon: 'inv_quiver_1h_mawraid_d_01',
      spellId: 392060,
      cooldown: 90, // one per Trueshot window (Trueshot transforms into it)
      usable: (s) => (trueshotUp(s) ? true : 'Trueshot transforms during its window'),
      onResolve: (s) => {
        s.damage('wailing_arrow', WAILING_COEFF)
        s.applyAura('player', 'deathblow') // grants another Black Arrow proc
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
      onResolve: (s) => {
        s.applyAura('player', 'trueshot')
        s.applyAura('player', 'deathblow') // Dark Ranger: free Black Arrow proc
      },
    },
  ],

  actionBar: [
    'explosive_shot', 'aimed_shot', 'black_arrow', 'rapid_fire',
    'volley', 'wailing_arrow', 'steady_shot', 'trueshot',
  ],

  hasteMod: (s) => (trueshotUp(s) ? TRUESHOT_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'black_arrow': return deathblowUp(s) || s.stacks('player', 'precise_shots') > 0
      case 'aimed_shot': return s.auraRemains('player', 'spotters_mark') > 0
      case 'wailing_arrow': return trueshotUp(s) && s.cooldownRemains('wailing_arrow') === 0
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'black_arrow', text: 'Spend Deathblow procs (free) and Precise Shots — never Aimed Shot with them waiting', when: s => deathblowUp(s) || s.stacks('player', 'precise_shots') > 0 },
    { abilityId: 'explosive_shot', text: 'On cooldown — cast both charges back to back (Unstable Trigger)', when: s => s.chargesOf('explosive_shot') > 0 },
    { abilityId: 'volley', text: 'On cooldown', when: s => s.cooldownRemains('volley') === 0 },
    { abilityId: 'trueshot', text: 'On cooldown — also grants a free Black Arrow proc', when: s => s.cooldownRemains('trueshot') === 0 },
    { abilityId: 'rapid_fire', text: 'On cooldown — refunds Aimed Shot, procs Deathblow + Precise Shots', when: s => s.cooldownRemains('rapid_fire') === 0 },
    { abilityId: 'wailing_arrow', text: 'Once per Trueshot, when no Black Arrow proc is already up', when: s => trueshotUp(s) && s.cooldownRemains('wailing_arrow') === 0 && !deathblowUp(s) },
    { abilityId: 'aimed_shot', text: 'Keep charges rolling — never with Precise Shots waiting' },
    { abilityId: 'black_arrow', text: 'Dump above ~75 Focus' },
    { abilityId: 'steady_shot', text: 'Filler — builds Focus' },
  ],

  /**
   * Oracle — hand-translated from the Method 12.1 Dark Ranger ST list
   * (Black Arrow to consume Precise Shots > Explosive > Volley > Trueshot >
   * Rapid Fire > Wailing Arrow > Aimed > fillers), with Icy Veins' proc
   * rule: cast Trueshot/Wailing Arrow when no Black Arrow proc is already up.
   */
  policy: (s) => {
    if (s.casting?.channel) return null // never clip Rapid Fire
    const focus = s.insanity
    const ps = s.stacks('player', 'precise_shots')

    // Black Arrow first: free on Deathblow, otherwise to consume Precise Shots
    if (deathblowUp(s)) return 'black_arrow'
    if (ps > 0 && focus >= 40) return 'black_arrow'

    if (s.chargesOf('explosive_shot') > 0 && focus >= 20) return 'explosive_shot'
    if (s.cooldownRemains('volley') === 0) return 'volley'
    if (s.cooldownRemains('trueshot') === 0) return 'trueshot'
    if (s.cooldownRemains('rapid_fire') === 0) return 'rapid_fire'
    if (trueshotUp(s) && s.cooldownRemains('wailing_arrow') === 0 && !deathblowUp(s)) {
      return 'wailing_arrow'
    }
    if (ps === 0 && s.chargesOf('aimed_shot') > 0 && focus >= 35) return 'aimed_shot'
    if (focus >= 75) return 'black_arrow'
    return 'steady_shot'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const spenders = ['black_arrow', 'aimed_shot']
    const fillers = ['steady_shot', 'black_arrow']
    const sets = [spenders, fillers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
