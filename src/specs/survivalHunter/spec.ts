import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Survival Hunter — patch 12.1.0 (Midnight, Season 2), Sentinel raid
 * single-target build. Verified against live guides 2026-08-24:
 * - Wowhead: https://www.wowhead.com/guide/classes/hunter/survival/rotation-cooldowns-pve-dps
 * - Icy Veins: https://www.icy-veins.com/wow/survival-hunter-pve-dps-rotation-cooldowns-abilities
 *   and https://www.icy-veins.com/wow/survival-hunter-pve-dps-easy-mode
 *   (Sentinel recommended for single target and Mythic+)
 * - Method: https://www.method.gg/guides/survival-hunter/playstyle-and-rotation
 *   (talent string from https://www.method.gg/guides/survival-hunter/talents,
 *   "Sentinel Single Target")
 *
 * Midnight rework highlights (corroborated by the guides above):
 * - Tip of the Spear is the golden rule: Kill Command grants 2 stacks
 *   (Primal Surge), max 3, and EVERY other damaging cast should consume one
 *   for a big bonus. Untipped Raptor Strike only as a resource-overflow valve.
 * - Mongoose Bite / Mongoose Fury windows, Coordinated Assault, Flanking
 *   Strike and Fury of the Eagle are gone from the 12.1 kit. Mongoose Fury
 *   survives as a short stacking buff granted by Boomstick blasts (Mongoose
 *   Rounds), buffing Raptor Strike per stack.
 * - Cooldowns: Takedown (60s with Savagery — heavy hit, +20% damage for 8s,
 *   doubles auto-attack speed) and Boomstick (60s — a burst of blasts).
 *   Flamefang Pitch is AoE-only and skipped for single target.
 * - Sentinel: Moonlight Chakram as an extra mid-cooldown throw.
 * - Wildfire Bomb holds 2 charges; burn modeled as scheduled pulses.
 * - S2 tier (folded in): 2pc = Raptor Strike +15% damage; 4pc = Mongoose
 *   Fury also increases Wildfire Bomb damage by 10%.
 *
 * APPROX (not published / simplified): all coefficients (AP units), Tip of
 * the Spear bonus (+30%), Kill Command as 2 charges / 6s recharge / 15
 * Focus, Boomstick as 4 blasts each granting 1 Mongoose Fury stack, Takedown
 * auto-speed doubling, Moonlight Chakram on a 45s cooldown, auto-attack
 * cadence, Raptor Swipe (Apex) treated as a passive and folded into Raptor
 * Strike's coefficient.
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
const TAKEDOWN_COEFF = 2.0
const TAKEDOWN_MULT = 1.2     // +20% all damage for 8s
const BOOMSTICK_BLAST = 0.9   // 4 blasts
const CHAKRAM_HIT = 1.2       // + 2 bounces at half value

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

export const survivalHunter: SpecConfig = {
  name: 'Survival Hunter',
  specId: 'hunter-survival',
  specIcon: 'ability_hunter_camouflage',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/hunter/survival/rotation-cooldowns-pve-dps',
    buildName: 'Sentinel Single Target (Method build)',
    heroTalent: 'Sentinel',
    talentString: 'C8PAAAAAAAAAAAAAAAAAAAAAAMgxMGWgNYGGawyMmZGzMLDAAAAAAzYGzssNjxMmBPgpZAAAAGAMjllZmZxYmxYmZAmZDYYMM2MAA',
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
  },

  auras: [
    { id: 'tip_of_the_spear', name: 'Tip of the Spear', icon: 'inv_spear_07', duration: 30, maxStacks: 3 },
    { id: 'mongoose_fury', name: 'Mongoose Fury', icon: 'ability_hunter_mongoosebite', duration: 12, maxStacks: 5 },
    { id: 'takedown', name: 'Takedown', icon: 'inv_coordinatedassault', duration: 8 },
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
        const tip = spendTip(s)
        s.damage('wildfire_bomb', BOMB_IMPACT * furyMult * tip)
        // burn: scheduled pulses, not a DoT aura
        for (let i = 1; i <= 5; i++) {
          s.schedule(s.time + i, () => s.damage('Wildfire Burn', BOMB_BURN * furyMult * tip, { canCrit: false }))
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
    {
      id: 'moonlight_chakram',
      name: 'Moonlight Chakram',
      icon: 'inv_glaive_1h_artifactazgalor_d_01',
      cooldown: 45, // APPROX
      onResolve: (s) => {
        const tip = spendTip(s)
        s.damage('moonlight_chakram', CHAKRAM_HIT * tip)
        for (let i = 1; i <= 2; i++) {
          s.schedule(s.time + i * 0.4, () => s.damage('moonlight_chakram', CHAKRAM_HIT * 0.5 * tip))
        }
      },
    },
  ],

  actionBar: [
    'kill_command', 'raptor_strike', 'wildfire_bomb', 'takedown',
    'boomstick', 'moonlight_chakram',
  ],

  damageMult: (s) => (s.auraRemains('player', 'takedown') > 0 ? TAKEDOWN_MULT : 1),

  glows: (s, id) => {
    switch (id) {
      case 'kill_command': return tipStacks(s) === 0 || s.chargesOf('kill_command') === 2
      case 'raptor_strike': return tipStacks(s) > 0 && s.insanity >= 30
      case 'takedown': return s.cooldownRemains('takedown') === 0 && tipStacks(s) > 0
      case 'boomstick': return s.cooldownRemains('boomstick') === 0 && tipStacks(s) > 0
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'takedown', text: 'On cooldown, always Tipped', when: s => s.cooldownRemains('takedown') === 0 && tipStacks(s) > 0 },
    { abilityId: 'boomstick', text: 'On cooldown, Tipped — blasts stack Mongoose Fury', when: s => s.cooldownRemains('boomstick') === 0 && tipStacks(s) > 0 },
    { abilityId: 'kill_command', text: 'At 0 Tip of the Spear — everything else must be Tipped', when: s => tipStacks(s) === 0 && s.chargesOf('kill_command') > 0 },
    { abilityId: 'wildfire_bomb', text: 'On cooldown with a Tip stack (never cap 2 charges)', when: s => s.chargesOf('wildfire_bomb') > 0 && tipStacks(s) > 0 },
    { abilityId: 'moonlight_chakram', text: 'On cooldown, Tipped (Sentinel)', when: s => s.cooldownRemains('moonlight_chakram') === 0 && tipStacks(s) > 0 },
    { abilityId: 'kill_command', text: 'Never sit at 2 charges', when: s => s.chargesOf('kill_command') === 2 },
    { abilityId: 'raptor_strike', text: 'Tipped spender with 30+ Focus (S2 2pc: +15%)' },
    { abilityId: 'kill_command', text: 'Below ~70 Focus — builds Focus and Tip stacks' },
    { abilityId: 'raptor_strike', text: 'Untipped only to burn off 70+ Focus' },
  ],

  /**
   * Oracle — hand-translated from the Icy Veins 12.1 easy-mode order
   * (Takedown > Boomstick > Kill Command at low Tip > Wildfire Bomb >
   * Raptor Strike, everything Tipped) plus the Sentinel Chakram throw.
   */
  policy: (s) => {
    const focus = s.insanity
    const tip = tipStacks(s)

    if (s.cooldownRemains('takedown') === 0 && tip > 0) return 'takedown'
    if (s.cooldownRemains('boomstick') === 0 && tip > 0) return 'boomstick'
    if (tip === 0 && s.chargesOf('kill_command') > 0) return 'kill_command'
    if (s.chargesOf('wildfire_bomb') > 0 && tip > 0) return 'wildfire_bomb'
    if (s.cooldownRemains('moonlight_chakram') === 0 && tip > 0) return 'moonlight_chakram'
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
