import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Fury Warrior — patch 12.1.0 (Midnight, Season 2), Mountain Thane raid ST
 * build (Icy Veins default), dual-wield. Built from the simc `midnight`
 * APL/source and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Rage (max 100) from a fast combined DW auto stream
 * (~6 rage per swing, ×1.5 during Recklessness — APPROX) plus Bloodthirst
 * and Raging Blow. Core loop: Rampage at 80+ Rage keeps Enrage rolling
 * (+25% haste, +15% damage); Bloodthirst crits also trigger Enrage.
 * Execute is excluded — the dummy never leaves 100% HP.
 * Talent assumptions: Mountain Thane (Bloodthirst/Rampage call Thunder
 * Blast strikes, 25% APPROX), Apex: Storm-King's Wrath 3/3 (Thunder Blasts
 * extend Enrage 1s). S2 tier: 2pc Raging Blow +20% (folded into the
 * coefficient); 4pc Odyn's Fury grants Enrage and 15 Rage (folded in).
 * APPROX-flagged: auto cadence/rage, Bloodthirst Enrage chance,
 * Recklessness modeled as +10% damage and +50% auto rage instead of +crit.
 * Damage in AP units.
 */

const AUTO_COEFF = 0.42
const SWING_TIME = 1.7
const SWING_RAGE = 6         // APPROX
const BT_COEFF = 1.15
const BT_RAGE = 8
const BT_CRIT_BONUS = 0.15   // Bloodcraze folded (APPROX) - added to crit chance
const RECK_CRIT = 0.25       // Recklessness: +crit for the Enrage roll
const RB_COEFF = 1.26        // incl. S2 2pc +20%
const RB_RAGE = 12
const RAMPAGE_HIT = 0.65     // ×4
const ODYNS_MAIN = 1.6
const ODYNS_WAVE = 0.7       // ×2
const ODYNS_RAGE = 15        // S2 4pc
const THUNDER_COEFF = 0.65
const THUNDER_CHANCE = 0.25  // APPROX
const ENRAGE_HASTE = 0.25
const ENRAGE_AMP = 1.15
const RECK_AMP = 1.10        // APPROX crit stand-in
const AVATAR_AMP = 1.20

function enraged(s: SimAPI): boolean {
  return s.auraRemains('player', 'enrage') > 0
}

/** Mountain Thane: Bloodthirst and Rampage can call down a Thunder Blast */
function rollThunderBlast(s: SimAPI) {
  if (s.rng('thunder_blast') < THUNDER_CHANCE) {
    s.schedule(s.time + 0.3, () => {
      s.damage('Thunder Blast', THUNDER_COEFF)
      // Apex: Storm-King's Wrath — Thunder Blasts extend Enrage 1s
      if (enraged(s)) s.extendAura('player', 'enrage', 1)
    })
  }
}

export const furyWarrior: SpecConfig = {
  name: 'Fury Warrior',
  specId: 'warrior-fury',
  specIcon: 'ability_warrior_innerrage',
  resourceName: 'Rage',
  resourceMax: 100,
  startingResource: 0,

  onCombatStart: (s) => {
    // combined dual-wield auto stream (APPROX)
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      const reck = s.auraRemains('player', 'recklessness') > 0
      s.gain(SWING_RAGE * (reck ? 1.5 : 1), 'auto')
      s.schedule(s.time + SWING_TIME * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'enrage', name: 'Enrage', icon: 'spell_shadow_unholyfrenzy', duration: 4 },
    { id: 'recklessness', name: 'Recklessness', icon: 'warrior_talent_icon_innerrage', duration: 12 },
    { id: 'avatar', name: 'Avatar', icon: 'warrior_talent_icon_avatar', duration: 20 },
  ],

  abilities: [
    {
      id: 'bloodthirst',
      name: 'Bloodthirst',
      icon: 'spell_nature_bloodlust',
      spellId: 23881,
      cooldown: 4.5,
      onResolve: (s) => {
        s.damage('bloodthirst', BT_COEFF)
        s.gain(BT_RAGE, 'bloodthirst')
        const reck = s.auraRemains('player', 'recklessness') > 0
        // Enrage procs off a real Bloodthirst crit roll: scales with the crit stat
        if (s.rng('bt_enrage') < Math.min(1, s.stats.critChance + BT_CRIT_BONUS + (reck ? RECK_CRIT : 0))) {
          s.applyAura('player', 'enrage')
        }
        rollThunderBlast(s)
      },
    },
    {
      id: 'raging_blow',
      name: 'Raging Blow',
      icon: 'warrior_wild_strike',
      spellId: 85288,
      cooldown: 8,
      charges: 2,
      onResolve: (s) => {
        s.damage('raging_blow', RB_COEFF)
        s.gain(RB_RAGE, 'raging_blow')
      },
    },
    {
      id: 'rampage',
      name: 'Rampage',
      icon: 'ability_warrior_rampage',
      spellId: 184367,
      cost: 80,
      onResolve: (s) => {
        for (let i = 0; i < 4; i++) {
          s.schedule(s.time + i * 0.1, () => s.damage('rampage', RAMPAGE_HIT))
        }
        s.applyAura('player', 'enrage')
        rollThunderBlast(s)
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
        s.applyAura('player', 'enrage') // S2 4pc
        s.gain(ODYNS_RAGE, 'odyns_fury')
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
    'bloodthirst', 'raging_blow', 'rampage', 'odyns_fury', 'recklessness', 'avatar',
  ],

  damageMult: (s) => {
    let m = 1
    if (enraged(s)) m *= ENRAGE_AMP
    if (s.auraRemains('player', 'recklessness') > 0) m *= RECK_AMP
    if (s.auraRemains('player', 'avatar') > 0) m *= AVATAR_AMP
    return m
  },
  hasteMod: (s) => (enraged(s) ? ENRAGE_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'rampage': return s.insanity >= 80
      case 'bloodthirst': return !enraged(s)
      case 'raging_blow': return s.chargesOf('raging_blow') === 2
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'recklessness', text: 'Off-GCD, on cooldown', when: s => s.cooldownRemains('recklessness') === 0 },
    { abilityId: 'avatar', text: 'Off-GCD, on cooldown (pair with Recklessness)', when: s => s.cooldownRemains('avatar') === 0 },
    { abilityId: 'rampage', text: 'At 80+ Rage — never cap, keep Enrage rolling', when: s => s.insanity >= 80 },
    { abilityId: 'odyns_fury', text: 'On cooldown (grants Enrage — 4pc)', when: s => s.cooldownRemains('odyns_fury') === 0 },
    { abilityId: 'bloodthirst', text: 'First when Enrage is down (crit fishing), else on cooldown' },
    { abilityId: 'raging_blow', text: 'Keep charges rolling — never sit at 2' },
  ],

  policy: (s) => {
    const rage = s.insanity

    if (s.cooldownRemains('recklessness') === 0) return 'recklessness'
    if (s.cooldownRemains('avatar') === 0) return 'avatar'
    if (rage >= 80) return 'rampage'
    if (!enraged(s) && s.cooldownRemains('bloodthirst') === 0) return 'bloodthirst'
    if (s.cooldownRemains('odyns_fury') === 0) return 'odyns_fury'
    if (s.cooldownRemains('bloodthirst') === 0) return 'bloodthirst'
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
