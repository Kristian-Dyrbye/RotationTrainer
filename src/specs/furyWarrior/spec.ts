import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Fury Warrior — patch 12.1.0 (Midnight, Season 2), Slayer raid single-target
 * build, dual-wield. Icy Veins' rotation selector marks Slayer "Single Target
 * best choice" in 12.1 (Mountain Thane leans multi-target/M+); Wowhead and
 * Method agree Slayer is the raid ST pick. Sources (verified 2026-08-24):
 * - Wowhead: https://www.wowhead.com/guide/classes/warrior/fury/rotation-cooldowns-pve-dps
 * - Icy Veins: https://www.icy-veins.com/wow/fury-warrior-pve-dps-rotation-cooldowns-abilities
 *   (talent string is Icy Veins' "Fury Single-Target - Slayer" loadout from
 *   https://www.icy-veins.com/wow/fury-warrior-pve-dps-spec-builds-talents)
 * - Method: https://www.method.gg/guides/fury-warrior/playstyle-and-rotation
 *
 * Resource model: Rage (max 100) from a fast combined DW auto stream
 * (~6 rage per swing, ×1.5 during Recklessness — APPROX) plus Bloodthirst,
 * Raging Blow and Sudden Death Executes. Core loop: Rampage keeps Enrage
 * rolling (+25% haste, +15% damage) — outside Recklessness cast it at 80+
 * Rage, inside Recklessness delay it toward the Rage cap ("Cast Rampage with
 * more than 100 Rage or if Enrage is not active" — Icy Veins, scaled to this
 * 100-Rage model as 95+). Bloodthirst crits also trigger Enrage.
 * Slayer mechanics modeled: Slayer's Dominance (attacks trigger Slayer's
 * Strike, stacking Marked for Execution ×3, +10% Execute damage each),
 * Imminent Demise (every 3rd Slayer's Strike grants Sudden Death, 2 stacks —
 * Execute usable at any HP, so the full-HP dummy convention holds),
 * Executioner (consuming Sudden Death refunds Bladestorm cooldown — 5s
 * APPROX), Unhinged (every other Bladestorm strike also casts Bloodthirst),
 * Reckless Abandon (Recklessness turns Bloodthirst/Raging Blow into
 * Bloodbath/Crushing Blow, +35% APPROX), Titanic Rage (Odyn's Fury grants
 * Enrage), Anger Management (Rage spent refunds Recklessness/Avatar, 1s per
 * 20 — APPROX). S2 tier: 2pc Raging Blow +15% (folded) and during
 * Recklessness Raging Blow extends it 2s, up to 6s (modeled); 4pc Bloodthirst
 * +10% (folded) and during Recklessness Bloodthirst stacks its crit bonus
 * (modeled as +2.5% damage ×2 — APPROX crit stand-in).
 * APPROX-flagged: auto cadence/rage, proc chances, Bladestorm as scheduled
 * pulses (no lock), Recklessness as +10% damage and +50% auto rage instead of
 * +crit, Hack and Slash unmodeled. Damage in AP units.
 */

const AUTO_COEFF = 0.42
const SWING_TIME = 1.7
const SWING_RAGE = 6          // APPROX
const BT_COEFF = 1.26         // 1.15 incl. S2 4pc +10%
const BT_RAGE = 8
const BT_CRIT_BONUS = 0.15    // Bloodcraze folded (APPROX) - added to crit chance
const RECK_CRIT = 0.25        // Recklessness: +crit for the Enrage roll
const RB_COEFF = 1.21         // 1.05 incl. S2 2pc +15%
const RB_RAGE = 12
const ABANDON_AMP = 1.35      // Reckless Abandon: Bloodbath/Crushing Blow (APPROX)
const RAMPAGE_HIT = 0.65      // ×4
const RAMPAGE_COST = 80
const ODYNS_MAIN = 1.6
const ODYNS_WAVE = 0.7        // ×2
const EXEC_COEFF = 2.0        // Sudden Death cast
const EXEC_RAGE = 20
const MARKED_AMP = 0.10       // Marked for Execution: +10% Execute per stack
const STRIKE_COEFF = 0.4      // Slayer's Strike (APPROX)
const STRIKE_CHANCE = 0.2     // per auto/BT/RB (APPROX)
const SD_BLADESTORM_REFUND = 5 // Executioner (APPROX)
const BLADESTORM_PULSE = 0.55 // ×6; every other pulse also casts Bloodthirst (Unhinged)
const ENRAGE_HASTE = 0.25
const ENRAGE_AMP = 1.15
const RECK_AMP = 1.10         // APPROX crit stand-in
const RECK_4PC_AMP = 0.025    // per Bloodthirst during Reck, ×2 (APPROX crit stand-in)
const AVATAR_AMP = 1.20

function enraged(s: SimAPI): boolean {
  return s.auraRemains('player', 'enrage') > 0
}

function reckUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'recklessness') > 0
}

/** Anger Management: every 20 Rage spent refunds 1s of Recklessness and Avatar (APPROX) */
function angerManagement(s: SimAPI, rageSpent: number) {
  s.reduceCooldown('recklessness', rageSpent / 20)
  s.reduceCooldown('avatar', rageSpent / 20)
}

/** Slayer's Dominance: attacks can trigger Slayer's Strike, stacking Marked
 *  for Execution; every 3rd strike grants Sudden Death (Imminent Demise). */
function rollSlayersStrike(s: SimAPI) {
  if (s.rng('slayers_strike') < STRIKE_CHANCE) {
    s.damage("Slayer's Strike", STRIKE_COEFF)
    s.applyAura('target', 'marked_for_execution', { stacks: 1 })
    s.data.strikeCount = (s.data.strikeCount ?? 0) + 1
    if (s.data.strikeCount >= 3) {
      s.data.strikeCount -= 3
      s.applyAura('player', 'sudden_death', { stacks: 1 })
    }
  }
}

/** Bloodthirst hit (or Bloodbath during Recklessness): damage, rage, Enrage crit roll */
function bloodthirstHit(s: SimAPI, fromBladestorm = false) {
  const reck = reckUp(s)
  s.damage(reck ? 'bloodbath' : 'bloodthirst', BT_COEFF * (reck ? ABANDON_AMP : 1))
  s.gain(BT_RAGE, 'bloodthirst')
  // Enrage procs off a real Bloodthirst crit roll: scales with the crit stat
  if (s.rng('bt_enrage') < Math.min(1, s.stats.critChance + BT_CRIT_BONUS + (reck ? RECK_CRIT : 0))) {
    s.applyAura('player', 'enrage')
  }
  if (reck) {
    // S2 4pc: Bloodthirst during Recklessness stacks its crit bonus (max 2)
    const r = s.aura('player', 'recklessness')
    if (r) r.data.critStacks = Math.min(2, (r.data.critStacks ?? 0) + 1)
  }
  if (!fromBladestorm) rollSlayersStrike(s)
}

export const furyWarrior: SpecConfig = {
  name: 'Fury Warrior',
  specId: 'warrior-fury',
  specIcon: 'ability_warrior_innerrage',
  resourceName: 'Rage',
  resourceMax: 100,
  startingResource: 0,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/warrior/fury/rotation-cooldowns-pve-dps',
    buildName: 'Slayer Raid Single-Target',
    heroTalent: 'Slayer',
    // Icy Veins "Fury Single-Target - Slayer" loadout (spec-builds-talents page)
    talentString: 'CgEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgGDzMmZ2MzMzMDjZmZGzYmlZmxMzMbmZmBAAixy2ALgJYGmAzwGwMDjNAAYmhxYYMYM',
    retrieved: '2026-08-24',
  },

  onCombatStart: (s) => {
    // combined dual-wield auto stream (APPROX)
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      s.gain(SWING_RAGE * (reckUp(s) ? 1.5 : 1), 'auto')
      rollSlayersStrike(s)
      s.schedule(s.time + SWING_TIME * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'enrage', name: 'Enrage', icon: 'spell_shadow_unholyfrenzy', duration: 4 },
    { id: 'recklessness', name: 'Recklessness', icon: 'warrior_talent_icon_innerrage', duration: 12 },
    { id: 'avatar', name: 'Avatar', icon: 'warrior_talent_icon_avatar', duration: 20 },
    { id: 'sudden_death', name: 'Sudden Death', icon: 'ability_warrior_improveddisciplines', duration: 10, maxStacks: 2 },
    { id: 'marked_for_execution', name: 'Marked for Execution', icon: 'ability_blackhand_marked4death', duration: 20, maxStacks: 3, debuff: true },
  ],

  abilities: [
    {
      // One button, as in game: Reckless Abandon turns it into Bloodbath.
      id: 'bloodthirst',
      name: 'Bloodthirst',
      icon: 'spell_nature_bloodlust',
      spellId: 23881,
      displayName: (s) => (reckUp(s) ? 'Bloodbath' : 'Bloodthirst'),
      displayIcon: (s) => (reckUp(s) ? 'ability_warrior_bloodbath' : 'spell_nature_bloodlust'),
      cooldown: 4.5,
      onResolve: (s) => bloodthirstHit(s),
    },
    {
      // One button, as in game: Reckless Abandon turns it into Crushing Blow.
      id: 'raging_blow',
      name: 'Raging Blow',
      icon: 'warrior_wild_strike',
      spellId: 85288,
      displayName: (s) => (reckUp(s) ? 'Crushing Blow' : 'Raging Blow'),
      displayIcon: (s) => (reckUp(s) ? 'ability_hunter_swiftstrike' : 'warrior_wild_strike'),
      cooldown: 8,
      charges: 2,
      onResolve: (s) => {
        const reck = reckUp(s)
        s.damage(reck ? 'crushing_blow' : 'raging_blow', RB_COEFF * (reck ? ABANDON_AMP : 1))
        s.gain(RB_RAGE, 'raging_blow')
        if (reck) {
          // S2 2pc: Raging Blow during Recklessness extends it 2s, up to 6s
          const r = s.aura('player', 'recklessness')
          if (r && (r.data.ext ?? 0) < 3) {
            r.data.ext = (r.data.ext ?? 0) + 1
            s.extendAura('player', 'recklessness', 2)
          }
        }
        rollSlayersStrike(s)
      },
    },
    {
      id: 'rampage',
      name: 'Rampage',
      icon: 'ability_warrior_rampage',
      spellId: 184367,
      cost: RAMPAGE_COST,
      onResolve: (s) => {
        for (let i = 0; i < 4; i++) {
          s.schedule(s.time + i * 0.1, () => s.damage('rampage', RAMPAGE_HIT))
        }
        s.applyAura('player', 'enrage')
        angerManagement(s, RAMPAGE_COST)
      },
    },
    {
      // Sudden Death proc cast only — usable at any HP, so the full-HP dummy works
      id: 'execute',
      name: 'Execute',
      icon: 'inv_sword_48',
      spellId: 5308,
      usable: (s) => s.stacks('player', 'sudden_death') > 0 || 'requires Sudden Death',
      onResolve: (s) => {
        const marked = s.stacks('target', 'marked_for_execution')
        if (marked > 0) s.removeAura('target', 'marked_for_execution')
        s.damage('execute', EXEC_COEFF * (1 + MARKED_AMP * marked))
        s.gain(EXEC_RAGE, 'execute')
        s.consumeStack('player', 'sudden_death')
        s.reduceCooldown('bladestorm', SD_BLADESTORM_REFUND) // Executioner
      },
    },
    {
      id: 'bladestorm',
      name: 'Bladestorm',
      icon: 'ability_warrior_bladestorm',
      spellId: 227847,
      cooldown: 90,
      onResolve: (s) => {
        for (let i = 0; i < 6; i++) {
          s.schedule(s.time + 0.5 * i, () => {
            s.damage('bladestorm', BLADESTORM_PULSE)
            // Unhinged: every other Bladestorm strike also casts Bloodthirst
            if (i % 2 === 1) bloodthirstHit(s, true)
          })
        }
      },
    },
    {
      id: 'odyns_fury',
      name: "Odyn's Fury",
      icon: 'inv_sword_1h_artifactvigfus_d_01',
      spellId: 385059,
      cooldown: 45,
      onResolve: (s) => {
        s.damage('odyns_fury', ODYNS_MAIN)
        for (let i = 1; i <= 2; i++) {
          s.schedule(s.time + i * 0.5, () => s.damage('odyns_fury', ODYNS_WAVE))
        }
        s.applyAura('player', 'enrage') // Titanic Rage
      },
    },
    {
      id: 'recklessness',
      name: 'Recklessness',
      icon: 'warrior_talent_icon_innerrage',
      spellId: 1719,
      cooldown: 90,
      offGcd: true,
      onResolve: (s) => s.applyAura('player', 'recklessness'),
    },
    {
      id: 'avatar',
      name: 'Avatar',
      icon: 'warrior_talent_icon_avatar',
      spellId: 107574,
      cooldown: 90,
      offGcd: true,
      onResolve: (s) => s.applyAura('player', 'avatar'),
    },
  ],

  actionBar: [
    'bloodthirst', 'raging_blow', 'rampage', 'execute', 'bladestorm',
    'odyns_fury', 'recklessness', 'avatar',
  ],

  damageMult: (s) => {
    let m = 1
    if (enraged(s)) m *= ENRAGE_AMP
    const r = s.aura('player', 'recklessness')
    if (r) m *= RECK_AMP * (1 + RECK_4PC_AMP * (r.data.critStacks ?? 0))
    if (s.auraRemains('player', 'avatar') > 0) m *= AVATAR_AMP
    return m
  },
  hasteMod: (s) => (enraged(s) ? ENRAGE_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'rampage': return s.insanity >= 80
      case 'bloodthirst': return !enraged(s)
      case 'raging_blow': return s.chargesOf('raging_blow') === 2
      case 'execute': return s.stacks('player', 'sudden_death') > 0
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'recklessness', text: 'Off-GCD, on cooldown (Anger Management brings it back)', when: s => s.cooldownRemains('recklessness') === 0 },
    { abilityId: 'avatar', text: 'Off-GCD, on cooldown (pair with Recklessness)', when: s => s.cooldownRemains('avatar') === 0 },
    { abilityId: 'rampage', text: 'Not Enraged, at 80+ Rage — inside Recklessness delay to ~95+', when: s => s.insanity >= RAMPAGE_COST && (!enraged(s) || !reckUp(s) || s.insanity >= 95) },
    { abilityId: 'bladestorm', text: 'Early in Recklessness while Enraged — or if Recklessness is 20s+ away (Executes refund it)', when: s => s.cooldownRemains('bladestorm') === 0 && enraged(s) && (reckUp(s) || s.cooldownRemains('recklessness') > 20) },
    { abilityId: 'execute', text: 'At 2 Sudden Death stacks — never overcap procs', when: s => s.stacks('player', 'sudden_death') >= 2 },
    { abilityId: 'bloodthirst', text: 'On cooldown (Bloodbath in Recklessness stacks the 4pc)' },
    { abilityId: 'execute', text: 'Spend single Sudden Death procs (eats Marked for Execution)', when: s => s.stacks('player', 'sudden_death') > 0 },
    { abilityId: 'odyns_fury', text: 'On cooldown while Enraged', when: s => s.cooldownRemains('odyns_fury') === 0 && enraged(s) },
    { abilityId: 'raging_blow', text: 'Keep charges rolling — never sit at 2' },
  ],

  /**
   * Oracle — Wowhead/Icy Veins/Method 12.1 Slayer ST priority, distilled to
   * this kit (Rampage thresholds scaled from their 120-Rage cap to this
   * 100-Rage model; Whirlwind filler omitted — pooling toward Rampage instead).
   */
  policy: (s) => {
    const rage = s.insanity
    const sd = s.stacks('player', 'sudden_death')

    if (s.cooldownRemains('recklessness') === 0) return 'recklessness'
    if (s.cooldownRemains('avatar') === 0) return 'avatar'
    if (rage >= RAMPAGE_COST && (!enraged(s) || !reckUp(s) || rage >= 95)) return 'rampage'
    if (s.cooldownRemains('bladestorm') === 0 && enraged(s) && (reckUp(s) || s.cooldownRemains('recklessness') > 20)) return 'bladestorm'
    if (sd >= 2) return 'execute'
    if (s.cooldownRemains('bloodthirst') === 0) return 'bloodthirst'
    if (sd >= 1) return 'execute'
    if (s.cooldownRemains('odyns_fury') === 0 && enraged(s)) return 'odyns_fury'
    if (s.chargesOf('raging_blow') > 0) return 'raging_blow'
    return null
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['bloodthirst', 'raging_blow']
    const cds = ['recklessness', 'avatar']
    const sets = [builders, cds]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
