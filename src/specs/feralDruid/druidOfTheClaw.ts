import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Feral Druid — patch 12.1.0 (Midnight, Season 2), Druid of the Claw raid
 * ST build (alternate build; default spec.ts = Wildstalker) with the S2
 * "Bark of the Enigmatic Dreamwatcher" tier 2pc+4pc.
 * Sources (verified 2026-08-24):
 *  - Wowhead rotation guide: https://www.wowhead.com/guide/classes/druid/feral/rotation-cooldowns-pve-dps
 *  - Method (publishes the Druid of the Claw ST priority + opener):
 *    https://www.method.gg/guides/feral-druid/playstyle-and-rotation
 *  - Icy Veins rotation (Ravage rules, Killing Strikes, Claw Rampage):
 *    https://www.icy-veins.com/wow/feral-druid-pve-dps-rotation-cooldowns-abilities
 *  - Icy Veins builds: https://www.icy-veins.com/wow/feral-druid-pve-dps-spec-builds-talents
 *    (publishes a Druid of the Claw string only as the Mythic+/AoE build —
 *    no raid-ST DotC string is published verbatim, so talentString is
 *    omitted rather than mislabeled)
 *
 * Druid of the Claw vs the default Wildstalker build: no Bloodseeker
 * Vines/Bursting Growth — instead auto-attacks can grant RAVAGE, which
 * transforms your next Ferocious Bite into a massively empowered strike
 * (one button, as in game; follows all Ferocious Bite rules). Killing
 * Strikes grants Ravage on the first Tiger's Fury each combat; Claw
 * Rampage makes Ravage procs far more likely during Berserk; Convoke
 * casts can also spit out Ravage. Saber Jaws: Bites/Ravages consume up to
 * 25 extra Energy for bonus damage (the "50+ Energy" rule in every
 * guide). Sudden Ambush procs from finishers empower Shred (Method lists
 * proc'd Shreds above the Rake refresh). Bloodtalons is REMOVED in
 * Midnight. Live priority modeled (Method/IV): Tiger's Fury on cd →
 * Berserk synced with TF → Feral Frenzy → Convoke during Berserk+TF with
 * Rip up → Apex Predator's Craving Bites → Rip in pandemic at 5 CP →
 * Ravage/Ferocious Bite at 5 CP with 50+ Energy → Sudden Ambush Shred →
 * keep Rake → keep Moonfire (Lunar Inspiration) → Shred.
 *
 * S2 tier: 2pc — when Berserk ends, +10% damage for 1s per combo point
 * spent during it; 4pc — Berserk lasts 10s longer (25s total).
 * Apex talent: Unseen Predator — Ferocious Bite has a chance per combo
 * point to deliver an Unseen Attack.
 *
 * Resource model shared with the base file: Energy (max 100, ~10/s hasted
 * regen); Combo Points are a 5-stack player aura. APPROX: bleed
 * snapshotting is NOT modeled (Tiger's Fury is a flat amp), Rip duration
 * fixed (finishers require 5 CP), Circle of Life and Death durations kept
 * from the base build (Rake 12s, Rip 18s, Moonfire ~14.4s), all proc
 * rates and coefficients (Ravage auto-proc chance, Sudden Ambush rate,
 * Saber Jaws bonus), Berserk as +1 CP on builders and -25% Energy costs,
 * Convoke condensed to a damage channel with CP trickle, Feral Frenzy's
 * bleed as scheduled pulses, Chomp not modeled (optional talent). Damage
 * in AP units.
 */

const AUTO_COEFF = 0.30
const SHRED_COEFF = 0.80
const RAKE_HIT = 0.30
const RAKE_TICK = 0.35          // every 2.25s over 12s (Circle of Life and Death)
const RIP_TICK = 0.40           // every 1.5s over 18s (Circle of Life and Death)
const MOONFIRE_HIT = 0.20       // Lunar Inspiration
const MOONFIRE_TICK = 0.22      // every 1.5s over 14.4s
const BITE_COEFF = 1.6          // at 5 CP
const RAVAGE_COEFF = 2.6        // Druid of the Claw empowered Bite
const FRENZY_HIT = 0.22         // 5 hits
const FRENZY_BLEED_PULSE = 0.18 // 6 pulses over 6s (scheduled, not a dot)
const CONVOKE_TICK = 0.55       // APPROX: 16-cast channel condensed
const UNSEEN_ATTACK = 0.60      // Apex: Unseen Predator flicker strike
const SABER_JAWS_MULT = 1.3     // full-Energy Bite/Ravage bonus (APPROX)
const SUDDEN_AMBUSH_MULT = 1.65 // Sudden Ambush empowered Shred (APPROX)
const TF_MULT = 1.15
const TIER_2PC_MULT = 1.10
const CC_CHANCE = 0.15          // APPROX: Omen of Clarity per auto
const APEX_CHANCE = 0.06        // APPROX: Apex Predator per Rip/Rake tick
const RAVAGE_CHANCE = 0.08      // APPROX: Ravage per auto-attack
const RAVAGE_CHANCE_BERSERK = 0.20 // APPROX: Claw Rampage during Berserk
const SUDDEN_AMBUSH_CHANCE = 0.25  // APPROX: per finisher
const CONVOKE_RAVAGE_CHANCE = 0.06 // APPROX: per Convoke cast

function cp(s: SimAPI): number {
  return s.stacks('player', 'combo_points')
}

/** Primal Fury: combo-generating crits award an extra point (scales with crit);
 *  Berserk: builders generate 1 additional combo point */
function addBuilderCP(s: SimAPI) {
  let n = s.rng('primal_fury') < s.stats.critChance ? 2 : 1
  if (s.auraRemains('player', 'berserk') > 0) n += 1
  addCP(s, n)
}

function addCP(s: SimAPI, n: number) {
  s.applyAura('player', 'combo_points', { stacks: n })
}

/** shared Rip/Rake tick procs: Apex Predator's Craving */
function bleedTickProcs(s: SimAPI) {
  if (s.rng('apex_predator') < APEX_CHANCE) s.applyAura('player', 'apex_predator')
}

function ravageReady(s: SimAPI): boolean {
  return s.auraRemains('player', 'ravage_ready') > 0
}

/** finishers: track combo points spent during Berserk for the S2 2pc,
 *  and roll for a Sudden Ambush proc */
function spendFinisherCP(s: SimAPI) {
  if (s.auraRemains('player', 'berserk') > 0) {
    s.data.berserkCP = (s.data.berserkCP ?? 0) + cp(s)
  }
  s.removeAura('player', 'combo_points')
  if (s.rng('sudden_ambush') < SUDDEN_AMBUSH_CHANCE) s.applyAura('player', 'sudden_ambush')
}

export const feralClaw: SpecConfig = {
  name: 'Feral Druid',
  specId: 'druid-feral',
  specIcon: 'ability_druid_catform',
  buildId: 'druid-of-the-claw',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/druid/feral/rotation-cooldowns-pve-dps',
    buildName: 'Druid of the Claw Raid Single-Target',
    heroTalent: 'Druid of the Claw',
    // Icy Veins publishes DotC only as its Mythic+/AoE string — no raid-ST
    // string exists verbatim, so none is cited here
    retrieved: '2026-08-24',
  },
  resourceName: 'Energy',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    // energy regen: ~10/s, scaled by haste
    const regen = () => {
      s.gain(5 / s.hasteMult(), 'energy_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
    // cat autos: 1s swing timer, hasted; Omen of Clarity and Druid of the
    // Claw's Ravage procs ride along (Claw Rampage boosts the rate in Berserk)
    const swing = () => {
      s.damage('Cat Melee', AUTO_COEFF)
      if (s.rng('omen_of_clarity') < CC_CHANCE) s.applyAura('player', 'clearcasting')
      const ravageChance = s.auraRemains('player', 'berserk') > 0 ? RAVAGE_CHANCE_BERSERK : RAVAGE_CHANCE
      if (s.rng('ravage_proc') < ravageChance) s.applyAura('player', 'ravage_ready')
      s.schedule(s.time + 1.0 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'combo_points', name: 'Combo Points', icon: 'ability_druid_catform', duration: Infinity, maxStacks: 5 },
    { id: 'clearcasting', name: 'Clearcasting', icon: 'spell_shadow_manaburn', duration: 15 },
    { id: 'apex_predator', name: "Apex Predator's Craving", icon: 'ability_druid_primaltenacity', duration: 15 },
    { id: 'ravage_ready', name: 'Ravage', icon: 'inv_ability_druidoftheclawdruid_ravage', duration: 20 },
    { id: 'sudden_ambush', name: 'Sudden Ambush', icon: 'ability_ambush', duration: 15 },
    { id: 'tigers_fury', name: "Tiger's Fury", icon: 'ability_mount_jungletiger', duration: 10 },
    {
      id: 'berserk', name: 'Berserk', icon: 'ability_druid_berserk', duration: 25, // S2 4pc: +10s
      onExpire: (s) => {
        // S2 2pc: +10% damage for 1s per combo point spent during Berserk
        const spent = s.data.berserkCP ?? 0
        s.data.berserkCP = 0
        if (spent > 0) s.applyAura('player', 'enigmatic_dreamwatcher', { duration: spent })
      },
    },
    { id: 'enigmatic_dreamwatcher', name: 'Enigmatic Dreamwatcher (2pc)', icon: 'ability_druid_berserk', duration: 30 },
    {
      id: 'rake_dot', name: 'Rake', icon: 'ability_druid_disembowel', duration: 12, pandemic: true, debuff: true,
      tick: {
        interval: 2.25, hasted: true,
        onTick: (s) => {
          s.damage('rake_dot', RAKE_TICK, { tags: ['bleed'] })
          bleedTickProcs(s)
        },
      },
    },
    {
      id: 'rip_dot', name: 'Rip', icon: 'ability_ghoulfrenzy', duration: 18, pandemic: true, debuff: true,
      tick: {
        interval: 1.5, hasted: true,
        onTick: (s) => {
          s.damage('rip_dot', RIP_TICK, { tags: ['bleed'] })
          bleedTickProcs(s)
        },
      },
    },
    {
      id: 'moonfire_dot', name: 'Moonfire', icon: 'spell_nature_starfall', duration: 14.4, pandemic: true, debuff: true,
      tick: { interval: 1.5, hasted: true, onTick: s => s.damage('moonfire_dot', MOONFIRE_TICK) },
    },
  ],

  abilities: [
    {
      id: 'shred',
      name: 'Shred',
      icon: 'spell_shadow_vampiricaura',
      spellId: 5221,
      cost: 40,
      costMod: (s) => {
        if (s.auraRemains('player', 'clearcasting') > 0) return 0
        return s.auraRemains('player', 'berserk') > 0 ? 30 : 40
      },
      onResolve: (s) => {
        if (s.auraRemains('player', 'clearcasting') > 0) s.removeAura('player', 'clearcasting')
        let mult = 1
        if (s.auraRemains('player', 'sudden_ambush') > 0) {
          s.removeAura('player', 'sudden_ambush')
          mult = SUDDEN_AMBUSH_MULT // as-if-from-stealth Shred
        }
        s.damage('shred', SHRED_COEFF * mult)
        addBuilderCP(s)
      },
    },
    {
      id: 'rake',
      name: 'Rake',
      icon: 'ability_druid_disembowel',
      spellId: 1822,
      cost: 35,
      costMod: (s) => (s.auraRemains('player', 'berserk') > 0 ? 26 : 35),
      onResolve: (s) => {
        s.damage('rake', RAKE_HIT)
        s.applyAura('target', 'rake_dot')
        addBuilderCP(s)
      },
    },
    {
      id: 'moonfire',
      name: 'Moonfire',
      icon: 'spell_nature_starfall',
      spellId: 155625, // Lunar Inspiration
      cost: 30,
      costMod: (s) => (s.auraRemains('player', 'berserk') > 0 ? 22 : 30),
      onResolve: (s) => {
        s.damage('moonfire', MOONFIRE_HIT)
        s.applyAura('target', 'moonfire_dot')
        addBuilderCP(s)
      },
    },
    {
      id: 'rip',
      name: 'Rip',
      icon: 'ability_ghoulfrenzy',
      spellId: 1079,
      cost: 20,
      costMod: (s) => (s.auraRemains('player', 'berserk') > 0 ? 15 : 20),
      usable: (s) => (cp(s) === 5 ? true : 'requires 5 combo points'),
      onResolve: (s) => {
        s.applyAura('target', 'rip_dot')
        spendFinisherCP(s)
      },
    },
    {
      // One button, as in game: Druid of the Claw's Ravage proc transforms it.
      id: 'ferocious_bite',
      name: 'Ferocious Bite',
      icon: 'ability_druid_ferociousbite',
      spellId: 22568,
      cost: 25,
      costMod: (s) => (s.auraRemains('player', 'apex_predator') > 0 ? 0 : (s.auraRemains('player', 'berserk') > 0 ? 18 : 25)),
      displayName: (s) => (ravageReady(s) ? 'Ravage' : 'Ferocious Bite'),
      displayIcon: (s) => (ravageReady(s) ? 'inv_ability_druidoftheclawdruid_ravage' : 'ability_druid_ferociousbite'),
      usable: (s) => (cp(s) === 5 || s.auraRemains('player', 'apex_predator') > 0
        ? true
        : 'requires 5 combo points'),
      onResolve: (s) => {
        const apex = s.auraRemains('player', 'apex_predator') > 0
        // Saber Jaws: consume up to 25 extra Energy for bonus damage
        let mult = 1
        if (s.insanity >= 25) {
          s.spend(25)
          mult = SABER_JAWS_MULT
        }
        if (ravageReady(s)) {
          s.removeAura('player', 'ravage_ready')
          s.damage('Ravage', RAVAGE_COEFF * mult)
        } else {
          s.damage('ferocious_bite', BITE_COEFF * mult)
        }
        // Apex talent: Unseen Predator — chance per combo point to flicker-strike
        if (s.rng('unseen_predator') < 0.08 * 5) {
          s.schedule(s.time + 0.3, () => s.damage('Unseen Attack', UNSEEN_ATTACK, { tags: ['bleed'] }))
        }
        if (apex) {
          s.removeAura('player', 'apex_predator') // free, keeps combo points
        } else {
          spendFinisherCP(s)
        }
      },
    },
    {
      id: 'tigers_fury',
      name: "Tiger's Fury",
      icon: 'ability_mount_jungletiger',
      spellId: 5217,
      cooldown: 30,
      offGcd: true,
      onResolve: (s) => {
        s.gain(50, 'tigers_fury')
        s.applyAura('player', 'tigers_fury')
        // Killing Strikes: the first Tiger's Fury each combat grants Ravage
        if (!s.data.killingStrikes) {
          s.data.killingStrikes = 1
          s.applyAura('player', 'ravage_ready')
        }
      },
    },
    {
      id: 'feral_frenzy',
      name: 'Feral Frenzy',
      icon: 'ability_druid_rake',
      spellId: 274837,
      cost: 25,
      cooldown: 45,
      onResolve: (s) => {
        addCP(s, 5)
        for (let i = 0; i < 5; i++) {
          s.schedule(s.time + 0.2 * i, () => s.damage('feral_frenzy', FRENZY_HIT))
        }
        // its bleed: short burst, modeled as scheduled pulses
        for (let i = 1; i <= 6; i++) {
          s.schedule(s.time + i, () => s.damage('Feral Frenzy (bleed)', FRENZY_BLEED_PULSE, { tags: ['bleed'] }))
        }
      },
    },
    {
      id: 'convoke',
      name: 'Convoke the Spirits',
      icon: 'inv_ability_druid_convokethespirits',
      spellId: 391528,
      cooldown: 120,
      channel: {
        duration: 4, ticks: 16, hasted: false,
        onTick: (s) => {
          s.damage('convoke', CONVOKE_TICK)
          if (s.rng('convoke_cp') < 0.25) addCP(s, 1)
          // Convoke casts can spit out a Ravage proc (Druid of the Claw)
          if (s.rng('convoke_ravage') < CONVOKE_RAVAGE_CHANCE) s.applyAura('player', 'ravage_ready')
        },
      },
      onResolve: () => {},
    },
    {
      id: 'berserk',
      name: 'Berserk',
      icon: 'ability_druid_berserk',
      spellId: 106951,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => {
        s.data.berserkCP = 0
        s.applyAura('player', 'berserk')
        s.gain(30, 'berserk')
      },
    },
  ],

  actionBar: [
    'shred', 'rake', 'moonfire', 'rip', 'ferocious_bite',
    'tigers_fury', 'feral_frenzy', 'convoke', 'berserk',
  ],

  damageMult: (s) => {
    let m = 1
    if (s.auraRemains('player', 'tigers_fury') > 0) m *= TF_MULT
    if (s.auraRemains('player', 'enigmatic_dreamwatcher') > 0) m *= TIER_2PC_MULT
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'ferocious_bite': return s.auraRemains('player', 'apex_predator') > 0 || (ravageReady(s) && cp(s) === 5)
      case 'shred': return s.auraRemains('player', 'clearcasting') > 0 || s.auraRemains('player', 'sudden_ambush') > 0
      case 'rip': return cp(s) === 5 && s.auraRemains('target', 'rip_dot') < 5.4
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'tigers_fury', text: 'Off-GCD, on cooldown when below ~40 Energy (first one grants Ravage — Killing Strikes)', when: s => s.cooldownRemains('tigers_fury') === 0 },
    { abilityId: 'berserk', text: 'Off-GCD, on cooldown — always synced with Tiger’s Fury (Claw Rampage fishes Ravage procs inside)', when: s => s.cooldownRemains('berserk') === 0 },
    { abilityId: 'feral_frenzy', text: 'On cooldown during Tiger’s Fury at 0-2 CP — instantly 5 CP', when: s => s.cooldownRemains('feral_frenzy') === 0 },
    { abilityId: 'convoke', text: 'During Berserk + Tiger’s Fury at low CP, with Rip running (can proc Ravage)', when: s => s.cooldownRemains('convoke') === 0 },
    { abilityId: 'ferocious_bite', text: "Apex Predator's Craving proc — free, keeps your combo points", when: s => s.auraRemains('player', 'apex_predator') > 0 },
    { abilityId: 'rip', text: 'At 5 CP when Rip is in the pandemic window (<5.4s) — never clip early', when: s => cp(s) === 5 && s.auraRemains('target', 'rip_dot') < 5.4 },
    { abilityId: 'ferocious_bite', text: 'Ravage / Ferocious Bite at 5 CP with 50+ Energy (Saber Jaws bonus)', when: s => cp(s) === 5 },
    { abilityId: 'shred', text: 'Sudden Ambush proc — empowered Shred', when: s => s.auraRemains('player', 'sudden_ambush') > 0 },
    { abilityId: 'rake', text: 'Keep the Rake bleed in pandemic (<3.6s)' },
    { abilityId: 'moonfire', text: 'Keep Moonfire rolling (Lunar Inspiration, refresh <4.3s)' },
    { abilityId: 'shred', text: 'Builder / Clearcasting spender — don’t cap Energy' },
  ],

  policy: (s) => {
    // never clip an in-progress Convoke
    if (s.casting?.channel && s.casting.abilityId === 'convoke') return null
    const energy = s.insanity
    const c = cp(s)
    const ripRemains = s.auraRemains('target', 'rip_dot')
    const rakeRemains = s.auraRemains('target', 'rake_dot')
    const mfRemains = s.auraRemains('target', 'moonfire_dot')
    const tfUp = s.auraRemains('player', 'tigers_fury') > 0

    if (s.cooldownRemains('tigers_fury') === 0 && energy < 40) return 'tigers_fury'
    if (s.cooldownRemains('berserk') === 0 && tfUp) return 'berserk'
    if (s.cooldownRemains('feral_frenzy') === 0 && c <= 2 && energy >= 25
      && (tfUp || s.cooldownRemains('tigers_fury') > 10)) return 'feral_frenzy'
    if (s.cooldownRemains('convoke') === 0 && s.auraRemains('player', 'berserk') > 0 && tfUp
      && c <= 1 && ripRemains > 4) return 'convoke'
    if (s.auraRemains('player', 'apex_predator') > 0) return 'ferocious_bite'
    if (c === 5) {
      if (ripRemains < 5.4 && energy >= 20) return 'rip'
      if (energy >= 50) return 'ferocious_bite'
      return null // pool Energy toward a 50+ Energy Ravage/Bite (Saber Jaws)
    }
    if (s.auraRemains('player', 'sudden_ambush') > 0
      && (energy >= 40 || s.auraRemains('player', 'clearcasting') > 0)) return 'shred'
    if (rakeRemains < 3.6 && energy >= 35) return 'rake'
    if (mfRemains < 4.3 && energy >= 30) return 'moonfire'
    return 'shred'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['shred', 'rake', 'moonfire']
    const finishers = ['rip', 'ferocious_bite']
    const sets = [builders, finishers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
