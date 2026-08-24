import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Fury Warrior — patch 12.1.0 (Midnight, Season 2), Mountain Thane raid
 * single-target build, dual-wield (alternate to the default Slayer build;
 * Icy Veins marks Slayer "Single Target best choice" in 12.1, with Mountain
 * Thane the multi-target/M+ lean). Verified 2026-08-24 against Wowhead (via
 * search snippets), Icy Veins (rotation page's Mountain Thane preset rows +
 * "Playing as Mountain Thane"), and Method (Mountain Thane rotation +
 * talents page).
 *
 * Sources:
 * - https://www.wowhead.com/guide/classes/warrior/fury/rotation-cooldowns-pve-dps
 * - https://www.icy-veins.com/wow/fury-warrior-pve-dps-rotation-cooldowns-abilities
 * - https://www.method.gg/guides/fury-warrior/playstyle-and-rotation
 *   (talent string is Method's "Mountain Thane: Single Target" loadout from
 *   https://www.method.gg/guides/fury-warrior/talents)
 *
 * Mountain Thane kit, per the 12.1 guides: Thunder Clap replaces Whirlwind
 * in the rotation and is "greatly empowered during Avatar" (its cooldown is
 * greatly reduced — usable every other GCD); Lightning Strikes proc from
 * Bloodthirst/Raging Blow/Execute/Thunder Clap (chance "surges by 50%
 * during Avatar") and can grant Thunder Blast (2 stacks), which replaces
 * the next Thunder Clap, extends Avatar's duration, and always triggers an
 * extra Lightning Strike. Icy Veins' Thunder Blast rule: cast with 2 stacks
 * of the buff, <2s of Avatar remaining, or <3s left on the buff — Method
 * adds "Thunder Blast with Avatar active" and Bloodthirst-fishing for
 * procs. Shared with the base build: Rampage/Enrage economy ("Rampage with
 * more than 100 Rage or if Enrage is not active", scaled to this 100-Rage
 * model as 95+ inside Recklessness), Bloodthirst crits triggering Enrage,
 * Reckless Abandon (Recklessness turns Bloodthirst/Raging Blow into
 * Bloodbath/Crushing Blow), Sudden Death Executes (plain proc chance here —
 * no Slayer Marked for Execution/Imminent Demise), and Anger Management
 * (Rage spent refunds Recklessness/Avatar, 1s per 20 — APPROX).
 * No Bladestorm/Odyn's Fury: Method's Mountain Thane single-target priority
 * omits both (Bladestorm is the Slayer pick), spending those GCDs on
 * Thunder Clap/Thunder Blast instead. S2 tier: 2pc Raging Blow +15%
 * (folded) and during Recklessness Raging Blow extends it 2s, up to 6s
 * (modeled); 4pc Bloodthirst +10% (folded) and during Recklessness
 * Bloodthirst stacks its crit bonus ("Cast Bloodbath twice to apply the
 * Season 2 tier set critical strike chance buff" — Icy Veins; modeled as
 * +2.5% damage ×2, an APPROX crit stand-in).
 * APPROX-flagged: auto cadence/rage, all proc chances and Lightning
 * Strike/Thunder Blast coefficients, Avatar extension per Thunder Blast
 * (+2s, capped at +10s), Thunder Clap's in-Avatar cooldown, Recklessness as
 * +10% damage and +50% auto rage instead of +crit, Hack and Slash
 * unmodeled. Damage in AP units.
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
const EXEC_COEFF = 2.0        // Sudden Death cast
const EXEC_RAGE = 20
const SUDDEN_DEATH_CHANCE = 0.08 // per auto/BT/RB (APPROX)
const TC_COEFF = 0.6          // Thunder Clap (APPROX)
const TC_AVATAR_CDR = 4.5     // in-Avatar cooldown refund: every other GCD (APPROX)
const TB_COEFF = 1.3          // Thunder Blast, Stormstrike damage (APPROX)
const TB_AVATAR_EXTEND = 2    // APPROX, capped below
const TB_EXTEND_CAP = 5       // max 5 extensions per Avatar (APPROX)
const LS_COEFF = 0.35         // Lightning Strike (APPROX)
const LS_CHANCE = 0.18        // per BT/RB/Execute/Thunder Clap (APPROX)
const LS_AVATAR_MULT = 1.5    // "surges by 50% during Avatar"
const LS_TB_CHANCE = 0.4      // Lightning Strike grants Thunder Blast (APPROX)
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

function avatarUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'avatar') > 0
}

function tbStacks(s: SimAPI): number {
  return s.stacks('player', 'thunder_blast')
}

/** Anger Management: every 20 Rage spent refunds 1s of Recklessness and Avatar (APPROX) */
function angerManagement(s: SimAPI, rageSpent: number) {
  s.reduceCooldown('recklessness', rageSpent / 20)
  s.reduceCooldown('avatar', rageSpent / 20)
}

/** Sudden Death: attacks have a chance to make the next Execute free (2 stacks) */
function rollSuddenDeath(s: SimAPI) {
  if (s.rng('sudden_death') < SUDDEN_DEATH_CHANCE) {
    s.applyAura('player', 'sudden_death', { stacks: 1 })
  }
}

/** Lightning Strikes: chance on Bloodthirst/Raging Blow/Execute/Thunder Clap,
 *  boosted during Avatar; each strike can grant a Thunder Blast stack. */
function rollLightningStrike(s: SimAPI, guaranteed = false) {
  const chance = LS_CHANCE * (avatarUp(s) ? LS_AVATAR_MULT : 1)
  if (guaranteed || s.rng('lightning_strike') < chance) {
    s.damage('Lightning Strike', LS_COEFF)
    if (s.rng('thunder_blast_gain') < LS_TB_CHANCE) {
      s.applyAura('player', 'thunder_blast', { stacks: 1 })
    }
  }
}

/** Bloodthirst hit (or Bloodbath during Recklessness): damage, rage, Enrage crit roll */
function bloodthirstHit(s: SimAPI) {
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
  rollLightningStrike(s)
  rollSuddenDeath(s)
}

export const furyMountainThane: SpecConfig = {
  name: 'Fury Warrior',
  specId: 'warrior-fury',
  specIcon: 'ability_warrior_innerrage',
  buildId: 'mountain-thane',
  resourceName: 'Rage',
  resourceMax: 100,
  startingResource: 0,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/warrior/fury/rotation-cooldowns-pve-dps',
    buildName: 'Mountain Thane Raid Single-Target',
    heroTalent: 'Mountain Thane',
    // Method's "Mountain Thane: Single Target" loadout (talents page, verified in raw HTML)
    talentString: 'CgEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgGDDzMz2yMzMzMMmZmZMjZWmZGjZmlxMzAAAhB2glNjGzAysgZsAYGMGAMzAYYMzMMYA',
    retrieved: '2026-08-24',
  },

  onCombatStart: (s) => {
    // combined dual-wield auto stream (APPROX)
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      s.gain(SWING_RAGE * (reckUp(s) ? 1.5 : 1), 'auto')
      rollSuddenDeath(s)
      s.schedule(s.time + SWING_TIME * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'enrage', name: 'Enrage', icon: 'spell_shadow_unholyfrenzy', duration: 4 },
    { id: 'recklessness', name: 'Recklessness', icon: 'warrior_talent_icon_innerrage', duration: 12 },
    { id: 'avatar', name: 'Avatar', icon: 'warrior_talent_icon_avatar', duration: 20 },
    { id: 'sudden_death', name: 'Sudden Death', icon: 'ability_warrior_improveddisciplines', duration: 10, maxStacks: 2 },
    { id: 'thunder_blast', name: 'Thunder Blast', icon: 'ability_thunderking_thunderstruck', duration: 15, maxStacks: 2 },
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
        rollLightningStrike(s)
        rollSuddenDeath(s)
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
        s.damage('execute', EXEC_COEFF)
        s.gain(EXEC_RAGE, 'execute')
        s.consumeStack('player', 'sudden_death')
        rollLightningStrike(s)
      },
    },
    {
      // One button, as in game: Thunder Blast replaces Thunder Clap.
      id: 'thunder_clap',
      name: 'Thunder Clap',
      icon: 'spell_nature_thunderclap',
      spellId: 6343,
      displayName: (s) => (tbStacks(s) > 0 ? 'Thunder Blast' : 'Thunder Clap'),
      displayIcon: (s) => (tbStacks(s) > 0 ? 'ability_thunderking_thunderstruck' : 'spell_nature_thunderclap'),
      displayStacks: (s) => tbStacks(s),
      cooldown: 6,
      onResolve: (s) => {
        if (tbStacks(s) > 0) {
          s.consumeStack('player', 'thunder_blast')
          s.damage('thunder_blast', TB_COEFF)
          // Thunder Blast extends Avatar and always triggers a Lightning Strike
          const av = s.aura('player', 'avatar')
          if (av && (av.data.ext ?? 0) < TB_EXTEND_CAP) {
            av.data.ext = (av.data.ext ?? 0) + 1
            s.extendAura('player', 'avatar', TB_AVATAR_EXTEND)
          }
          rollLightningStrike(s, true)
        } else {
          s.damage('thunder_clap', TC_COEFF)
          rollLightningStrike(s)
        }
        // During Avatar the cooldown is greatly reduced: every other GCD
        if (avatarUp(s)) s.reduceCooldown('thunder_clap', TC_AVATAR_CDR)
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
    'bloodthirst', 'raging_blow', 'rampage', 'execute', 'thunder_clap',
    'recklessness', 'avatar',
  ],

  damageMult: (s) => {
    let m = 1
    if (enraged(s)) m *= ENRAGE_AMP
    const r = s.aura('player', 'recklessness')
    if (r) m *= RECK_AMP * (1 + RECK_4PC_AMP * (r.data.critStacks ?? 0))
    if (avatarUp(s)) m *= AVATAR_AMP
    return m
  },
  hasteMod: (s) => (enraged(s) ? ENRAGE_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'rampage': return s.insanity >= 80
      case 'bloodthirst': return !enraged(s)
      case 'raging_blow': return s.chargesOf('raging_blow') === 2
      case 'execute': return s.stacks('player', 'sudden_death') > 0
      case 'thunder_clap': return tbStacks(s) > 0
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'recklessness', text: 'Off-GCD, on cooldown (Anger Management brings it back)', when: s => s.cooldownRemains('recklessness') === 0 },
    { abilityId: 'avatar', text: 'Off-GCD, on cooldown (macro with Recklessness — Thunder Blast extends it)', when: s => s.cooldownRemains('avatar') === 0 },
    { abilityId: 'rampage', text: 'Not Enraged, at 80+ Rage — inside Recklessness delay to ~95+', when: s => s.insanity >= RAMPAGE_COST && (!enraged(s) || !reckUp(s) || s.insanity >= 95) },
    { abilityId: 'execute', text: 'At 2 Sudden Death stacks — never overcap procs', when: s => s.stacks('player', 'sudden_death') >= 2 },
    { abilityId: 'thunder_clap', label: 'Thunder Blast', icon: 'ability_thunderking_thunderstruck', text: 'At 2 Thunder Blast stacks, <2s of Avatar left, or the buff about to expire', when: s => s.cooldownRemains('thunder_clap') === 0 && (tbStacks(s) >= 2 || (tbStacks(s) > 0 && ((s.auraRemains('player', 'avatar') > 0 && s.auraRemains('player', 'avatar') < 2) || s.auraRemains('player', 'thunder_blast') < 3))) },
    { abilityId: 'bloodthirst', text: 'On cooldown — fishes Enrage, Lightning Strikes, and Thunder Blast (4pc in Recklessness)' },
    { abilityId: 'execute', text: 'Spend single Sudden Death procs', when: s => s.stacks('player', 'sudden_death') > 0 },
    { abilityId: 'thunder_clap', label: 'Thunder Blast', icon: 'ability_thunderking_thunderstruck', text: 'Spend Thunder Blast procs — extends Avatar, guaranteed Lightning Strike', when: s => s.cooldownRemains('thunder_clap') === 0 && tbStacks(s) > 0 },
    { abilityId: 'raging_blow', text: 'Keep charges rolling — never sit at 2' },
    { abilityId: 'thunder_clap', text: 'Filler when nothing else is available (cheap during Avatar)', when: s => s.cooldownRemains('thunder_clap') === 0 },
  ],

  /**
   * Oracle — Icy Veins Mountain Thane preset rows + Method 12.1 Mountain
   * Thane priority, distilled to this kit (Rampage thresholds scaled from
   * their 120-Rage cap to this 100-Rage model; Whirlwind replaced by
   * Thunder Clap as the guides describe).
   */
  policy: (s) => {
    const rage = s.insanity
    const sd = s.stacks('player', 'sudden_death')
    const tb = tbStacks(s)
    const tcReady = s.cooldownRemains('thunder_clap') === 0
    const avRemains = s.auraRemains('player', 'avatar')

    if (s.cooldownRemains('recklessness') === 0) return 'recklessness'
    if (s.cooldownRemains('avatar') === 0) return 'avatar'
    if (rage >= RAMPAGE_COST && (!enraged(s) || !reckUp(s) || rage >= 95)) return 'rampage'
    if (sd >= 2) return 'execute'
    if (tcReady && (tb >= 2 || (tb > 0 && ((avRemains > 0 && avRemains < 2) || s.auraRemains('player', 'thunder_blast') < 3)))) return 'thunder_clap'
    if (s.cooldownRemains('bloodthirst') === 0) return 'bloodthirst'
    if (sd >= 1) return 'execute'
    if (tcReady && tb > 0) return 'thunder_clap'
    if (s.chargesOf('raging_blow') > 0) return 'raging_blow'
    if (tcReady) return 'thunder_clap'
    return null
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['bloodthirst', 'raging_blow', 'thunder_clap']
    const cds = ['recklessness', 'avatar']
    const sets = [builders, cds]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
