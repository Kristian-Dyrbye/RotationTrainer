import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Survival Hunter — patch 12.1.0 (Midnight, Season 2), Pack Leader raid
 * single-target build (alternate to the default Sentinel build in spec.ts;
 * Icy Veins notes Sentinel remains the recommended raid ST pick).
 * Verified against live guides 2026-08-24:
 * - Wowhead: https://www.wowhead.com/guide/classes/hunter/survival/rotation-cooldowns-pve-dps
 * - Icy Veins: https://www.icy-veins.com/wow/survival-hunter-pve-dps-rotation-cooldowns-abilities
 * - Method: https://www.method.gg/guides/survival-hunter/playstyle-and-rotation
 *   (talent string from https://www.method.gg/guides/survival-hunter/talents,
 *   "Pack Leader Single Target")
 *
 * Shared Midnight class facts (same as spec.ts): Tip of the Spear economy
 * (Kill Command grants 2 stacks via Primal Surge, max 3; every other
 * damaging cast should consume one), Mongoose Bite kit removed, cooldowns
 * are Takedown (60s, +20% damage 8s, doubled auto speed) and Boomstick
 * (60s burst of blasts stacking Mongoose Fury), S2 tier = Raptor Strike
 * +15% (2pc) and Mongoose Fury buffing Wildfire Bomb (4pc).
 *
 * Pack Leader differences (Icy Veins + Method, corroborating each other):
 * - Howl of the Pack Leader: Takedown immediately readies a Howl, and it
 *   also comes up on its own cadence; the next Kill Command then summons a
 *   beast — the first one in a Takedown window charges a Stampede line
 *   dealing heavy damage over ~7 seconds.
 * - The summoned Wyvern circles overhead for a while; Method: cast Wildfire
 *   Bomb (Tipped) while the Wyvern is active.
 * - Icy Veins Pack Leader ST order: Kill Command below 2 Tips when a Howl
 *   is ready or Takedown is coming up > Takedown > Wildfire Bomb >
 *   Boomstick > Raptor Strike, everything Tipped.
 * - No Moonlight Chakram (that is the Sentinel capstone).
 *
 * APPROX (not published / simplified): all coefficients (AP units), Howl's
 * own cadence (30s internal timer), the beast summon modeled as a 5-hit
 * Stampede over ~7s plus a 10s Wyvern buff (+15% Wildfire Bomb), Tip of
 * the Spear bonus (+30%), Kill Command as 2 charges / 6s recharge / 15
 * Focus, Boomstick as 4 blasts each granting 1 Mongoose Fury stack,
 * Takedown auto-speed doubling, auto-attack cadence.
 */

const AUTO_COEFF = 0.46       // APPROX: 2h melee
const AUTO_SWING = 2.6
const KC_COEFF = 1.1
const KC_FOCUS = 15
const RS_COEFF = 1.0 * 1.15   // incl. S2 2pc +15%
const RS_PER_FURY = 0.10      // Mongoose Fury: +10% Raptor Strike per stack
const TIP_MULT = 1.30         // APPROX: Tip of the Spear bonus on the tipped cast
const BOMB_IMPACT = 1.4
const BOMB_BURN = 0.25        // 5 pulses over 5s
const BOMB_FURY_MULT = 1.10   // S2 4pc: Mongoose Fury also buffs Wildfire Bomb
const BOMB_WYVERN_MULT = 1.15 // APPROX: Pack Leader Wyvern buffs Wildfire Bomb
const TAKEDOWN_COEFF = 2.0
const TAKEDOWN_MULT = 1.2     // +20% all damage for 8s
const BOOMSTICK_BLAST = 0.9   // 4 blasts
const STAMPEDE_HIT = 0.5      // APPROX: 5 hits over ~7s
const HOWL_TIMER = 30         // APPROX: Howl's own cadence between Takedowns

/** consume a Tip of the Spear stack if one is up; returns the damage mult */
function spendTip(s: SimAPI): number {
  if (s.stacks('player', 'tip_of_the_spear') > 0) {
    s.consumeStack('player', 'tip_of_the_spear')
    return TIP_MULT
  }
  return 1
}

function tipStacks(s: SimAPI): number {
  return s.stacks('player', 'tip_of_the_spear')
}

/** Howl of the Pack Leader ready — the next Kill Command summons a beast */
function howlReady(s: SimAPI): boolean {
  return s.auraRemains('player', 'howl_ready') > 0
}

/** Pack Leader beast summon: a Stampede line over ~7s, plus the Wyvern */
function summonBeast(s: SimAPI) {
  for (let i = 0; i < 5; i++) {
    s.schedule(s.time + 0.6 + i * 1.5, () => s.damage('Stampede', STAMPEDE_HIT))
  }
  s.applyAura('player', 'wyvern')
}

export const survivalPackLeader: SpecConfig = {
  name: 'Survival Hunter',
  specId: 'hunter-survival',
  specIcon: 'ability_hunter_camouflage',
  buildId: 'pack-leader',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/hunter/survival/rotation-cooldowns-pve-dps',
    buildName: 'Pack Leader Single Target (Method build — Sentinel remains the recommended raid pick)',
    heroTalent: 'Pack Leader',
    talentString: 'C8PAAAAAAAAAAAAAAAAAAAAAAMgxMGWIbwMM0glZMzMmZWGAAAAAAmxMmZZbGjZMDeATzAAAAMAYGLLzMzixMjxMDgZ2AmFjhxmBA',
    retrieved: '2026-08-24',
  },
  resourceName: 'Focus',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    // melee autos; Takedown doubles attack speed for its duration
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      const speedUp = s.auraRemains('player', 'takedown') > 0 ? 2 : 1
      s.schedule(s.time + (AUTO_SWING * s.hasteMult()) / speedUp, swing)
    }
    s.schedule(s.time + 0.3, swing)
    // passive Focus regen: 5/s base, hasted, 0.5s granularity
    const regen = () => {
      s.gain(2.5 / s.hasteMult(), 'focus_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
    // Howl of the Pack Leader's own cadence (Takedown also readies one)
    s.data.howl = 12 // first natural Howl arrives early
    const howlLoop = () => {
      s.data.howl = (s.data.howl ?? HOWL_TIMER) - 0.5
      if (s.data.howl <= 0) {
        s.data.howl += HOWL_TIMER
        s.applyAura('player', 'howl_ready')
      }
      s.schedule(s.time + 0.5, howlLoop)
    }
    s.schedule(s.time + 0.5, howlLoop)
  },

  auras: [
    { id: 'tip_of_the_spear', name: 'Tip of the Spear', icon: 'inv_spear_07', duration: 30, maxStacks: 3 },
    { id: 'mongoose_fury', name: 'Mongoose Fury', icon: 'ability_hunter_mongoosebite', duration: 12, maxStacks: 5 },
    { id: 'takedown', name: 'Takedown', icon: 'inv_coordinatedassault', duration: 8 },
    {
      id: 'howl_ready',
      name: 'Howl of the Pack Leader',
      icon: 'inv_ability_packleaderhunter_vicioushunt',
      duration: 30,
    },
    {
      id: 'wyvern',
      name: 'Wyvern',
      icon: 'ability_mount_wyvern_01',
      duration: 10, // APPROX: buffs Wildfire Bomb while it circles overhead
    },
  ],

  abilities: [
    {
      id: 'kill_command',
      name: 'Kill Command',
      icon: 'ability_hunter_killcommand',
      spellId: 259489,
      cooldown: 6,
      charges: 2,
      onResolve: (s) => {
        s.damage('kill_command', KC_COEFF)
        s.gain(KC_FOCUS, 'kill_command')
        // Primal Surge: Kill Command grants 2 Tip of the Spear stacks (max 3)
        s.applyAura('player', 'tip_of_the_spear', { stacks: 2 })
        // Pack Leader: a Howl-empowered Kill Command summons a beast
        if (howlReady(s)) {
          s.removeAura('player', 'howl_ready')
          summonBeast(s)
        }
      },
    },
    {
      id: 'raptor_strike',
      name: 'Raptor Strike',
      icon: 'ability_hunter_raptorstrike',
      spellId: 186270,
      cost: 30,
      onResolve: (s) => {
        const fury = s.stacks('player', 'mongoose_fury')
        s.damage('raptor_strike', RS_COEFF * (1 + RS_PER_FURY * fury) * spendTip(s))
      },
    },
    {
      id: 'wildfire_bomb',
      name: 'Wildfire Bomb',
      icon: 'inv_misc_bomb_05',
      spellId: 259495,
      cooldown: 18,
      charges: 2,
      onResolve: (s) => {
        const furyMult = s.auraRemains('player', 'mongoose_fury') > 0 ? BOMB_FURY_MULT : 1 // S2 4pc
        const wyvernMult = s.auraRemains('player', 'wyvern') > 0 ? BOMB_WYVERN_MULT : 1
        const tip = spendTip(s)
        const mult = furyMult * wyvernMult * tip
        s.damage('wildfire_bomb', BOMB_IMPACT * mult)
        // burn: scheduled pulses, not a DoT aura
        for (let i = 1; i <= 5; i++) {
          s.schedule(s.time + i, () => s.damage('Wildfire Burn', BOMB_BURN * mult, { canCrit: false }))
        }
      },
    },
    {
      id: 'takedown',
      name: 'Takedown',
      icon: 'inv_coordinatedassault',
      cooldown: 60, // with Savagery
      onResolve: (s) => {
        s.damage('takedown', TAKEDOWN_COEFF * spendTip(s))
        s.applyAura('player', 'takedown') // +20% damage, doubled auto speed, 8s
        // Pack Leader: Takedown immediately readies a Howl
        s.applyAura('player', 'howl_ready')
      },
    },
    {
      id: 'boomstick',
      name: 'Boomstick',
      icon: 'inv_weapon_rifle_01',
      cooldown: 60,
      onResolve: (s) => {
        const tip = spendTip(s)
        // 4 blasts over ~3s; Mongoose Rounds: each blast grants a Mongoose
        // Fury stack (buffing Raptor Strike, and Wildfire Bomb via the 4pc)
        for (let i = 0; i < 4; i++) {
          s.schedule(s.time + 0.4 + i * 0.9, () => {
            s.damage('Boomstick Blast', BOOMSTICK_BLAST * tip)
            s.applyAura('player', 'mongoose_fury', { stacks: 1 })
          })
        }
      },
    },
  ],

  actionBar: [
    'kill_command', 'raptor_strike', 'wildfire_bomb', 'takedown', 'boomstick',
  ],

  damageMult: (s) => (s.auraRemains('player', 'takedown') > 0 ? TAKEDOWN_MULT : 1),

  glows: (s, id) => {
    switch (id) {
      case 'kill_command': return howlReady(s) || tipStacks(s) === 0 || s.chargesOf('kill_command') === 2
      case 'raptor_strike': return tipStacks(s) > 0 && s.insanity >= 30
      case 'takedown': return s.cooldownRemains('takedown') === 0 && tipStacks(s) > 0
      case 'wildfire_bomb': return s.auraRemains('player', 'wyvern') > 0 && tipStacks(s) > 0 && s.chargesOf('wildfire_bomb') > 0
      case 'boomstick': return s.cooldownRemains('boomstick') === 0 && tipStacks(s) > 0
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'kill_command', text: 'When Howl of the Pack Leader is ready — summons a beast', when: s => howlReady(s) && s.chargesOf('kill_command') > 0 },
    { abilityId: 'kill_command', text: 'Below 2 Tips when Takedown is about to come off cooldown (≤3s)', when: s => tipStacks(s) < 2 && s.cooldownRemains('takedown') <= 3 && s.cooldownRemains('takedown') > 0 && s.chargesOf('kill_command') > 0 },
    { abilityId: 'takedown', text: 'On cooldown, Tipped — immediately readies a Howl', when: s => s.cooldownRemains('takedown') === 0 && tipStacks(s) > 0 },
    { abilityId: 'kill_command', text: 'At 0 Tip of the Spear — everything else must be Tipped', when: s => tipStacks(s) === 0 && s.chargesOf('kill_command') > 0 },
    { abilityId: 'wildfire_bomb', text: 'On cooldown, Tipped — especially while the Wyvern is up', when: s => s.chargesOf('wildfire_bomb') > 0 && tipStacks(s) > 0 },
    { abilityId: 'boomstick', text: 'On cooldown, Tipped — blasts stack Mongoose Fury', when: s => s.cooldownRemains('boomstick') === 0 && tipStacks(s) > 0 },
    { abilityId: 'kill_command', text: 'Never sit at 2 charges', when: s => s.chargesOf('kill_command') === 2 },
    { abilityId: 'raptor_strike', text: 'Tipped spender with 30+ Focus (S2 2pc: +15%)' },
    { abilityId: 'kill_command', text: 'Below ~70 Focus — builds Focus and Tip stacks' },
    { abilityId: 'raptor_strike', text: 'Untipped only to burn off 70+ Focus' },
  ],

  /**
   * Oracle — hand-translated from the Icy Veins 12.1 Pack Leader ST order
   * (Kill Command below 2 Tips when a Howl is ready or Takedown is coming
   * up > Takedown > Wildfire Bomb > Boomstick > Raptor Strike, everything
   * Tipped), with Method's Pack Leader notes (Howl Kill Command first,
   * Wildfire Bomb while the Wyvern is active).
   */
  policy: (s) => {
    const focus = s.insanity
    const tip = tipStacks(s)

    // Howl-empowered Kill Command summons the beast — top priority
    if (howlReady(s) && s.chargesOf('kill_command') > 0) return 'kill_command'
    // build Tips ahead of Takedown
    if (tip < 2 && s.cooldownRemains('takedown') > 0 && s.cooldownRemains('takedown') <= 3
      && s.chargesOf('kill_command') > 0) {
      return 'kill_command'
    }
    if (s.cooldownRemains('takedown') === 0 && tip > 0) return 'takedown'
    if (tip === 0 && s.chargesOf('kill_command') > 0) return 'kill_command'
    if (s.chargesOf('wildfire_bomb') > 0 && tip > 0) return 'wildfire_bomb'
    if (s.cooldownRemains('boomstick') === 0 && tip > 0) return 'boomstick'
    if (s.chargesOf('kill_command') === 2) return 'kill_command'
    if (tip > 0 && focus >= 30) return 'raptor_strike'
    if (s.chargesOf('kill_command') > 0 && focus <= 70) return 'kill_command'
    if (focus >= 70) return 'raptor_strike' // overflow valve — untipped is a last resort
    return null // pool for the next Tipped cast
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['kill_command', 'raptor_strike']
    const tipped = ['raptor_strike', 'wildfire_bomb']
    const sets = [builders, tipped]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
