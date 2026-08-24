import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Arms Warrior — patch 12.1.0 (Midnight, Season 2), Colossus raid
 * single-target build, 2H (alternate to the default Slayer build; Icy Veins
 * and Maxroll both put Slayer ahead on raid ST in 12.1, with Colossus the
 * multi-target/burst alternative). Verified 2026-08-24 against Wowhead
 * (via search snippets), Icy Veins (rotation page's Colossus preset rows +
 * "Playing as a Colossus"), Method (Colossus opener/rotation + talents
 * page), and Maxroll's 12.1 raid guide.
 *
 * Sources:
 * - https://www.wowhead.com/guide/classes/warrior/arms/rotation-cooldowns-pve-dps
 * - https://www.icy-veins.com/wow/arms-warrior-pve-dps-rotation-cooldowns-abilities
 * - https://www.method.gg/guides/arms-warrior/playstyle-and-rotation
 *   (talent string is Method's "Colossus - Single Target" loadout from
 *   https://www.method.gg/guides/arms-warrior/talents)
 * - https://maxroll.gg/wow/class-guides/arms-warrior-raid-guide
 *
 * Colossus kit, per the 12.1 guides: Demolish (30s cooldown in 12.1,
 * "generally lines up with Colossus Smash, and the two should be used
 * together as much as possible" — Icy Veins) replaces Bladestorm's role;
 * Colossal Might (Mortal Strike grants a stack; +5% Demolish damage per
 * stack, max 10 with Dominance of the Colossus, which also refunds 5s of
 * Demolish's cooldown when a stack would be gained at cap) is consumed by
 * Demolish; Ravager is "the Colossus counterpart to Bladestorm", kept
 * aligned with Colossus Smash; Battlelord (Overpower can reset Mortal
 * Strike and grant 10 Rage — Method names Battlelord + Sudden Death as
 * Colossus' proc economy); Sudden Death procs make Execute free and usable
 * at any HP (plain proc chance — no Slayer Marked for Execution/Imminent
 * Demise here); Executioner's Precision (Execute buffs the next Mortal
 * Strike, 2 stacks — Method's execute rotation); Martial Prowess (Overpower
 * stacks amp Mortal Strike); the Midnight Apex Heroic Strike proc (replaces
 * Slam, free); Anger Management (Rage spent refunds Avatar/Ravager, 1s per
 * 20 — APPROX); Apex: Titanic Rupture (Demolish extends Colossus Smash 3s —
 * APPROX, carried over from the prior simc-based model of this build).
 * S2 tier ("Jade Warlord's Dominion", shared with Slayer): 2pc Mortal
 * Strike/Execute +10% (folded into coefficients); 4pc Overpower +15%
 * (folded) and Mortal Strike/Overpower buff the next Slam/Heroic Strike
 * +20%, stacking 5 (modeled).
 * APPROX-flagged: auto cadence/rage, all proc chances, Demolish modeled as
 * 3 scheduled hits instead of the in-game channel lock, Ravager as
 * scheduled pulses, Heroic Strike coefficient, Sudden Death proc rate.
 * Damage in AP units.
 */

const AUTO_COEFF = 1.0
const SWING_TIME = 3.6
const SWING_RAGE = 15          // APPROX
const MS_COEFF = 2.86          // 2.6 incl. S2 2pc +10%
const MS_PER_OP = 0.15         // Martial Prowess: +15% per Overpower stack
const MS_PER_PRECISION = 0.15  // Executioner's Precision: +15% per stack (APPROX)
const OP_COEFF = 1.27          // 1.1 incl. S2 4pc +15%
const BATTLELORD_CHANCE = 0.25 // Overpower resets Mortal Strike (APPROX)
const BATTLELORD_RAGE = 10
const EXEC_COEFF = 2.4         // incl. S2 2pc +10%; Sudden Death cast (free)
const SUDDEN_DEATH_CHANCE = 0.10 // per auto/MS/OP/Slam (APPROX)
const CS_COEFF = 1.5
const CS_AMP = 1.30            // Colossus Smash: +30% damage taken
const REND_DIRECT = 0.30
const REND_TICK = 0.26         // per 3s tick
const DEMOLISH_HIT = 1.3       // ×3 (APPROX; +30% in 12.1)
const MIGHT_PER_STACK = 0.05   // Colossal Might: +5% Demolish per stack
const MIGHT_MAX = 10           // with Dominance of the Colossus
const DOMINANCE_CDR = 5        // Demolish CDR per stack gained at cap (12.1)
const RAVAGER_PULSE = 0.5      // ×6 over 10s (APPROX)
const SLAM_COEFF = 0.85
const HS_COEFF = 1.5           // Apex Heroic Strike proc (APPROX)
const HS_CHANCE = 0.20         // per MS/OP (APPROX)
const SURGE_PER_STACK = 0.20   // S2 4pc: next Slam/HS +20% per stack, max 5
const AVATAR_AMP = 1.20

function csUp(s: SimAPI): boolean {
  return s.auraRemains('target', 'colossus_smash') > 0
}

function hsReady(s: SimAPI): boolean {
  return s.auraRemains('player', 'heroic_strike_ready') > 0
}

/** Anger Management: every 20 Rage spent refunds 1s of Avatar and Ravager (APPROX) */
function angerManagement(s: SimAPI, rageSpent: number) {
  s.reduceCooldown('avatar', rageSpent / 20)
  s.reduceCooldown('ravager', rageSpent / 20)
}

/** Sudden Death: attacks have a chance to make the next Execute free (2 stacks) */
function rollSuddenDeath(s: SimAPI) {
  if (s.rng('sudden_death') < SUDDEN_DEATH_CHANCE) {
    s.applyAura('player', 'sudden_death', { stacks: 1 })
  }
}

/** Colossal Might from Mortal Strike; at cap, Dominance refunds Demolish cooldown */
function gainColossalMight(s: SimAPI) {
  const atCap = s.stacks('player', 'colossal_might') >= MIGHT_MAX
  s.applyAura('player', 'colossal_might', { stacks: 1 })
  if (atCap) s.reduceCooldown('demolish', DOMINANCE_CDR) // Dominance of the Colossus
}

export const armsColossus: SpecConfig = {
  name: 'Arms Warrior',
  specId: 'warrior-arms',
  specIcon: 'ability_warrior_savageblow',
  buildId: 'colossus',
  resourceName: 'Rage',
  resourceMax: 100,
  startingResource: 0,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/warrior/arms/rotation-cooldowns-pve-dps',
    buildName: 'Colossus Raid Single-Target',
    heroTalent: 'Colossus',
    // Method's "Colossus - Single Target" loadout (talents page, verified in raw HTML)
    talentString: 'CcEAAAAAAAAAAAAAAAAAAAAAAAzMzsMzMzMDAAAghphZYGbLzMzMDzYmBAAAAwMmZAZGwmZMsBDMj2oxgFwMDGjBzYwMDAYGDD',
    retrieved: '2026-08-24',
  },

  onCombatStart: (s) => {
    // slow 2H swings; rage per swing is the main income (APPROX)
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      s.gain(SWING_RAGE, 'auto')
      rollSuddenDeath(s)
      s.schedule(s.time + SWING_TIME * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'overpower', name: 'Overpower', icon: 'ability_meleedamage', duration: 15, maxStacks: 2 },
    { id: 'colossus_smash', name: 'Colossus Smash', icon: 'ability_warrior_colossussmash', duration: 10, debuff: true },
    { id: 'avatar', name: 'Avatar', icon: 'warrior_talent_icon_avatar', duration: 20 },
    { id: 'sudden_death', name: 'Sudden Death', icon: 'ability_warrior_improveddisciplines', duration: 10, maxStacks: 2 },
    { id: 'colossal_might', name: 'Colossal Might', icon: 'ability_warrior_strengthofarms', duration: 24, maxStacks: MIGHT_MAX },
    { id: 'executioners_precision', name: "Executioner's Precision", icon: 'inv_sword_48', duration: 30, maxStacks: 2 },
    { id: 'slam_surge', name: "Warlord's Surge", icon: 'ability_warrior_endlessrage', duration: 15, maxStacks: 5 },
    { id: 'heroic_strike_ready', name: 'Heroic Strike!', icon: 'ability_rogue_ambush', duration: 12 },
    {
      id: 'rend', name: 'Rend', icon: 'ability_gouge', duration: 15, pandemic: true, debuff: true,
      tick: { interval: 3, hasted: true, onTick: s => s.damage('rend', REND_TICK) },
    },
  ],

  abilities: [
    {
      id: 'mortal_strike',
      name: 'Mortal Strike',
      icon: 'ability_warrior_savageblow',
      spellId: 12294,
      cost: 30,
      cooldown: 6,
      onResolve: (s) => {
        const op = s.stacks('player', 'overpower')
        if (op > 0) s.removeAura('player', 'overpower')
        const prec = s.stacks('player', 'executioners_precision')
        if (prec > 0) s.removeAura('player', 'executioners_precision')
        s.damage('mortal_strike', MS_COEFF * (1 + MS_PER_OP * op) * (1 + MS_PER_PRECISION * prec))
        gainColossalMight(s)
        s.applyAura('player', 'slam_surge', { stacks: 1 }) // S2 4pc
        if (s.rng('hs_proc') < HS_CHANCE) s.applyAura('player', 'heroic_strike_ready')
        rollSuddenDeath(s)
        angerManagement(s, 30)
      },
    },
    {
      id: 'overpower',
      name: 'Overpower',
      icon: 'ability_meleedamage',
      spellId: 7384,
      cooldown: 12,
      charges: 2,
      onResolve: (s) => {
        s.damage('overpower', OP_COEFF)
        s.applyAura('player', 'overpower', { stacks: 1 })
        s.applyAura('player', 'slam_surge', { stacks: 1 }) // S2 4pc
        // Battlelord: chance to reset Mortal Strike and generate Rage
        if (s.rng('battlelord') < BATTLELORD_CHANCE) {
          s.resetCooldown('mortal_strike')
          s.gain(BATTLELORD_RAGE, 'battlelord')
        }
        if (s.rng('hs_proc') < HS_CHANCE) s.applyAura('player', 'heroic_strike_ready')
        rollSuddenDeath(s)
      },
    },
    {
      id: 'rend',
      name: 'Rend',
      icon: 'ability_gouge',
      spellId: 772,
      cost: 20,
      onResolve: (s) => {
        s.damage('rend', REND_DIRECT)
        s.applyAura('target', 'rend')
        angerManagement(s, 20)
      },
    },
    {
      // Sudden Death proc cast only — the dummy never leaves 100% HP
      id: 'execute',
      name: 'Execute',
      icon: 'inv_sword_48',
      spellId: 163201,
      usable: (s) => s.stacks('player', 'sudden_death') > 0 || 'requires Sudden Death',
      onResolve: (s) => {
        s.damage('execute', EXEC_COEFF)
        s.consumeStack('player', 'sudden_death')
        // Executioner's Precision: buffs the next Mortal Strike
        s.applyAura('player', 'executioners_precision', { stacks: 1 })
      },
    },
    {
      id: 'colossus_smash',
      name: 'Colossus Smash',
      icon: 'ability_warrior_colossussmash',
      spellId: 167105,
      cooldown: 45,
      onResolve: (s) => {
        s.damage('colossus_smash', CS_COEFF)
        s.applyAura('target', 'colossus_smash')
      },
    },
    {
      // Colossus capstone: in-game a 2s channel; modeled as 3 staggered hits
      id: 'demolish',
      name: 'Demolish',
      icon: 'inv_ability_colossuswarrior_demolish',
      spellId: 436358,
      cooldown: 30, // 12.1: reduced to 30s, lining up with Colossus Smash
      onResolve: (s) => {
        const might = s.stacks('player', 'colossal_might')
        if (might > 0) s.removeAura('player', 'colossal_might')
        const mult = 1 + MIGHT_PER_STACK * might
        for (let i = 0; i < 3; i++) {
          s.schedule(s.time + i * 0.6, () => s.damage('demolish', DEMOLISH_HIT * mult))
        }
        // Apex: Titanic Rupture — Demolish extends Colossus Smash 3s (APPROX)
        if (csUp(s)) s.extendAura('target', 'colossus_smash', 3)
      },
    },
    {
      // "The Colossus counterpart to Bladestorm" — kept aligned with Colossus Smash
      id: 'ravager',
      name: 'Ravager',
      icon: 'warrior_talent_icon_ravager',
      spellId: 228920,
      cooldown: 90,
      onResolve: (s) => {
        for (let i = 0; i < 6; i++) {
          s.schedule(s.time + 2 * i, () => s.damage('ravager', RAVAGER_PULSE))
        }
      },
    },
    {
      // One button, as in game: the Apex Heroic Strike proc replaces Slam.
      id: 'slam',
      name: 'Slam',
      icon: 'ability_warrior_decisivestrike',
      spellId: 1464,
      displayName: (s) => (hsReady(s) ? 'Heroic Strike' : 'Slam'),
      displayIcon: (s) => (hsReady(s) ? 'ability_rogue_ambush' : 'ability_warrior_decisivestrike'),
      cost: 20,
      costMod: (s) => (hsReady(s) ? 0 : 20),
      onResolve: (s) => {
        const surge = s.stacks('player', 'slam_surge')
        if (surge > 0) s.removeAura('player', 'slam_surge')
        const mult = 1 + SURGE_PER_STACK * surge // S2 4pc
        if (hsReady(s)) {
          s.removeAura('player', 'heroic_strike_ready')
          s.damage('heroic_strike', HS_COEFF * mult)
        } else {
          s.damage('slam', SLAM_COEFF * mult)
          rollSuddenDeath(s)
          angerManagement(s, 20)
        }
      },
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
    'mortal_strike', 'overpower', 'rend', 'slam', 'execute',
    'colossus_smash', 'demolish', 'ravager', 'avatar',
  ],

  damageMult: (s) => {
    let m = 1
    if (csUp(s)) m *= CS_AMP
    if (s.auraRemains('player', 'avatar') > 0) m *= AVATAR_AMP
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'mortal_strike': return s.stacks('player', 'overpower') === 2
      case 'rend': return s.auraRemains('target', 'rend') < 4.5
      case 'execute': return s.stacks('player', 'sudden_death') > 0
      case 'slam': return hsReady(s) || s.stacks('player', 'slam_surge') === 5
      case 'demolish': return s.cooldownRemains('demolish') === 0 && csUp(s)
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'avatar', text: 'Off-GCD, on cooldown (Anger Management brings it back fast)', when: s => s.cooldownRemains('avatar') === 0 },
    { abilityId: 'ravager', text: 'Just before Colossus Smash — keep the two aligned', when: s => s.cooldownRemains('ravager') === 0 && (s.cooldownRemains('colossus_smash') === 0 || csUp(s)) },
    { abilityId: 'colossus_smash', text: 'On cooldown — everything hits +30% inside it', when: s => s.cooldownRemains('colossus_smash') === 0 },
    { abilityId: 'rend', text: 'Refresh in the pandemic window (<4.5s left)' },
    { abilityId: 'demolish', text: 'During Colossus Smash, with Colossal Might stacked', when: s => s.cooldownRemains('demolish') === 0 && csUp(s) },
    { abilityId: 'slam', label: 'Heroic Strike', icon: 'ability_rogue_ambush', text: 'Free Apex proc — press before spending Rage', when: s => hsReady(s) },
    { abilityId: 'execute', text: 'At 2 Sudden Death stacks — never overcap procs', when: s => s.stacks('player', 'sudden_death') >= 2 },
    { abilityId: 'mortal_strike', text: 'On cooldown — stacks Colossal Might for Demolish' },
    { abilityId: 'execute', text: 'Spend single Sudden Death procs (buffs Mortal Strike)', when: s => s.stacks('player', 'sudden_death') > 0 },
    { abilityId: 'overpower', text: 'Free — Battlelord can reset Mortal Strike, never cap charges' },
    { abilityId: 'slam', text: 'Dump Rage above 60 — never cap' },
  ],

  /**
   * Oracle — Icy Veins Colossus preset rows + Method 12.1 Colossus priority,
   * distilled to this kit (Execute exists only through Sudden Death on the
   * full-HP dummy; Demolish rides the Colossus Smash window).
   */
  policy: (s) => {
    const rage = s.insanity
    const sd = s.stacks('player', 'sudden_death')
    const rendRemains = s.auraRemains('target', 'rend')

    if (s.cooldownRemains('avatar') === 0) return 'avatar'
    if (s.cooldownRemains('ravager') === 0 && (s.cooldownRemains('colossus_smash') === 0 || csUp(s))) return 'ravager'
    if (s.cooldownRemains('colossus_smash') === 0) return 'colossus_smash'
    if (rendRemains < 4.5 && rage >= 20) return 'rend'
    if (s.cooldownRemains('demolish') === 0 && (csUp(s) || s.cooldownRemains('colossus_smash') > 15)) return 'demolish'
    if (hsReady(s)) return 'slam' // Heroic Strike proc
    if (sd >= 2) return 'execute'
    if (s.cooldownRemains('mortal_strike') === 0 && rage >= 30) return 'mortal_strike'
    if (sd >= 1) return 'execute'
    if (s.chargesOf('overpower') > 0) return 'overpower'
    if (rage >= 60) return 'slam'
    return null
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['overpower', 'slam']
    const heavyHits = ['mortal_strike', 'execute']
    const csWindow = ['demolish', 'ravager']
    const sets = [fillers, heavyHits, csWindow]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
