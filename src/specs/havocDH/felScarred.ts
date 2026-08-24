import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Havoc Demon Hunter — patch 12.1.0 (Midnight, Season 2), Fel-Scarred
 * raid single-target build (the alternate raid build to Aldrachi Reaver).
 * Verified 2026-08-24 against:
 * - Wowhead: Havoc DH Rotation Guide (Midnight)
 *   https://www.wowhead.com/guide/classes/demon-hunter/havoc/rotation-cooldowns-pve-dps
 * - Icy Veins: Havoc DH Rotation/Talents 12.1
 *   https://www.icy-veins.com/wow/havoc-demon-hunter-pve-dps-rotation-cooldowns-abilities
 * - Method: Havoc DH Playstyle & Rotation + Talents, Midnight 12.1
 *   https://www.method.gg/guides/havoc-demon-hunter/playstyle-and-rotation
 *   https://www.method.gg/guides/havoc-demon-hunter/talents
 *
 * 12.1 state: after the S2 nerfs Icy Veins gives Aldrachi Reaver the edge
 * in pure single-target, but Fel-Scarred remains the other raid build
 * (Method still lists "Fel-Scarred - Raid (Recommended)"). Kit: everything
 * revolves around Metamorphosis. Entering demon form induces a Demonsurge
 * (Chaos damage burst) and empowers Death Sweep (2 casts, Eternal Hunt)
 * and Annihilation (1 cast) — each empowered first cast detonates another
 * Demonsurge. Casting Metamorphosis (Demonic Intensity) also empowers
 * Eye Beam -> Abyssal Gaze and Immolation Aura -> Consuming Fire, and an
 * Abyssal Gaze that triggers Demonic generates a fresh set of Demonsurge
 * procs. A Fire Inside: Immolation Aura has 2 charges and Metamorphosis
 * refunds them — never sit at 2 charges, drain to 0 before Metamorphosis.
 *
 * Resource model: Fury (max 120). DW auto-attacks with Demon Blades
 * (chance per swing to strike again and generate Fury — flat-chance
 * stand-in for the RPPM model, APPROX).
 * Talent assumptions: Demon Blades, First Blood, Demonic, Essence Break,
 * The Hunt, Cycle of Hatred (spenders tick down Eye Beam — APPROX flat
 * CDR), A Fire Inside, Eternal Hunt, Demonic Intensity.
 * S2 tier (Abyssal Doomhound's Pursuit): 2pc Blade Dance/Chaos Strike/
 * Essence Break +12% (folded into coefficients); 4pc Essence Break +35%
 * initial hit, 6s window, and it rides Cycle of Hatred CDR.
 * APPROX-flagged: auto cadence, Demon Blades chance/Fury, Cycle of Hatred
 * as flat per-cast CDR, Demonsurge/Abyssal Gaze/Consuming Fire
 * coefficients, Death Sweep sharing Blade Dance's 15s recharge,
 * Metamorphosis refunding both Immolation charges via a cooldown reset,
 * empowerment auras held for 30s instead of "until consumed in demon
 * form", Inertia/Exergy movement micro (Vengeful Retreat/Fel Rush) not
 * modeled on the training dummy. Damage in AP units.
 */

const AUTO_COEFF = 0.30
const DEMON_BLADES_COEFF = 0.18
const DEMON_BLADES_CHANCE = 0.60 // APPROX
const DEMON_BLADES_FURY = 8
const FELBLADE_COEFF = 0.9
const CS_COEFF = 2.13            // 1.9 base, incl. S2 2pc +12%
const CRITICAL_CHAOS = 0.20      // added to crit chance for the refund roll (APPROX)
const BD_COEFF = 1.9             // First Blood single-target, incl. S2 2pc +12%
const EYE_BEAM_TICK = 0.62       // 4 ticks
const ABYSSAL_TICK = 0.93        // Abyssal Gaze empowered channel (APPROX +50%)
const EB_COEFF = 1.95            // incl. S2 2pc +12% and 4pc +35% initial hit
const EB_AMP = 1.4               // Essence Break amp on Chaos Strike/Blade Dance
const EB_DURATION = 6            // 4s + 2s from S2 4pc
const IMMO_INITIAL = 0.5
const CF_INITIAL = 1.0           // Consuming Fire empowered initial hit (APPROX)
const IMMO_TICK = 0.19
const HUNT_HIT = 1.9
const HUNT_PULSE = 0.35          // 6 scheduled pulses (not a debuff aura)
const META_DMG = 1.2
const FURIOUS_GAZE_HASTE = 0.10
const DEMONSURGE_COEFF = 0.85    // Chaos damage burst per surge (APPROX)
const COH_EYE_CDR = 1.0          // Cycle of Hatred per spender cast (APPROX)
const COH_EB_CDR = 0.5           // S2 4pc: Essence Break rides Cycle of Hatred

function metaUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'metamorphosis') > 0
}

/** Demonsurge: a burst of Chaos damage around the Demon Hunter */
function demonsurge(s: SimAPI) {
  s.damage('demonsurge', DEMONSURGE_COEFF, { tags: ['chaos'] })
}

/** Grant the Demonsurge empowerments: 2 Death Sweeps (Eternal Hunt) + 1 Annihilation */
function grantSurges(s: SimAPI) {
  s.applyAura('player', 'demonsurge_deathsweep', { stacks: 2 })
  s.applyAura('player', 'demonsurge_annihilation', { stacks: 1 })
}

/** Cycle of Hatred: Fury spenders tick down Eye Beam (and Essence Break, S2 4pc) */
function cycleOfHatred(s: SimAPI) {
  s.reduceCooldown('eye_beam', COH_EYE_CDR)
  s.reduceCooldown('essence_break', COH_EB_CDR)
}

/** Demonic: entering demon form induces a Demonsurge and arms the empowered casts */
function grantDemonic(s: SimAPI) {
  const wasUp = metaUp(s)
  if (wasUp) s.extendAura('player', 'metamorphosis', 4)
  else s.applyAura('player', 'metamorphosis', { duration: 6 })
  if (!wasUp) demonsurge(s)
  grantSurges(s)
}

export const havocFelScarred: SpecConfig = {
  name: 'Havoc Demon Hunter',
  specId: 'dh-havoc',
  specIcon: 'ability_demonhunter_specdps',
  buildId: 'fel-scarred',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/demon-hunter/havoc/rotation-cooldowns-pve-dps',
    buildName: 'Fel-Scarred Raid / Single Target',
    heroTalent: 'Fel-Scarred',
    // Method 12.1 "Fel-Scarred - Raid (Recommended)" import code
    // (Icy Veins publishes no Fel-Scarred raid-ST string in 12.1)
    talentString: 'CEkAAAAAAAAAAAAAAAAAAAAAAYAzMz2MmZmxMzkxMDAAAAAAY2MmtZYmxyMzYZm5BmZWmZWGjBWmFzYY200wMjhNAAAAAAAAmZwAAAAwA',
    retrieved: '2026-08-24',
  },
  resourceName: 'Fury',
  resourceMax: 120,
  startingResource: 0,

  onCombatStart: (s) => {
    // DW autos: combined stream; Demon Blades procs strike again for Fury
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      if (s.rng('demon_blades') < DEMON_BLADES_CHANCE) {
        s.damage('demon_blades', DEMON_BLADES_COEFF)
        s.gain(DEMON_BLADES_FURY, 'demon_blades')
      }
      s.schedule(s.time + 0.9 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'metamorphosis', name: 'Metamorphosis', icon: 'ability_demonhunter_metamorphasisdps', duration: 20 },
    { id: 'furious_gaze', name: 'Furious Gaze', icon: 'ability_demonhunter_eyebeam', duration: 10 },
    { id: 'essence_break', name: 'Essence Break', icon: 'spell_shadow_ritualofsacrifice', duration: EB_DURATION, debuff: true },
    { id: 'demonsurge_deathsweep', name: 'Demonsurge: Death Sweep', icon: 'inv_ability_felscarreddemonhunter_demonsurge', duration: 12, maxStacks: 2 },
    { id: 'demonsurge_annihilation', name: 'Demonsurge: Annihilation', icon: 'inv_ability_felscarreddemonhunter_demonsurge', duration: 12, maxStacks: 1 },
    { id: 'abyssal_gaze', name: 'Abyssal Gaze', icon: 'spell_shadow_evileye', duration: 30 },
    { id: 'consuming_fire', name: 'Consuming Fire', icon: 'spell_fire_incinerate', duration: 30 },
    {
      id: 'immolation_aura', name: 'Immolation Aura', icon: 'ability_demonhunter_immolation', duration: 6,
      tick: {
        interval: 1, hasted: false,
        onTick: (s) => {
          s.damage('immolation_aura', IMMO_TICK, { tags: ['fire'] })
          s.gain(2, 'immolation_aura')
        },
      },
    },
  ],

  abilities: [
    {
      id: 'chaos_strike',
      name: 'Chaos Strike',
      icon: 'ability_demonhunter_chaosstrike',
      spellId: 162794,
      cost: 40,
      displayName: (s) => (metaUp(s) ? 'Annihilation' : 'Chaos Strike'),
      displayIcon: (s) => (metaUp(s) ? 'inv_glaive_1h_npc_d_02' : 'ability_demonhunter_chaosstrike'),
      displayStacks: (s) => s.stacks('player', 'demonsurge_annihilation'),
      onResolve: (s) => {
        const mult = s.auraRemains('target', 'essence_break') > 0 ? EB_AMP : 1
        s.damage('chaos_strike', CS_COEFF * mult, { tags: ['chaos'] })
        // Fel-Scarred: the first empowered Annihilation detonates a Demonsurge
        if (metaUp(s) && s.stacks('player', 'demonsurge_annihilation') > 0) {
          s.consumeStack('player', 'demonsurge_annihilation')
          demonsurge(s)
        }
        // refund chance equals your crit chance (+ Critical Chaos): scales with the crit stat
        if (s.rng('chaos_refund') < Math.min(1, s.stats.critChance + CRITICAL_CHAOS)) s.gain(20, 'chaos_refund')
        cycleOfHatred(s)
      },
    },
    {
      id: 'blade_dance',
      name: 'Blade Dance',
      icon: 'ability_demonhunter_bladedance',
      spellId: 188499,
      cost: 35,
      cooldown: 15,
      displayName: (s) => (metaUp(s) ? 'Death Sweep' : 'Blade Dance'),
      displayIcon: (s) => (metaUp(s) ? 'inv_glaive_1h_artifactaldrochi_d_02' : 'ability_demonhunter_bladedance'),
      displayStacks: (s) => s.stacks('player', 'demonsurge_deathsweep'),
      onResolve: (s) => {
        const mult = s.auraRemains('target', 'essence_break') > 0 ? EB_AMP : 1
        // 4 quick hits
        for (let i = 0; i < 4; i++) {
          s.schedule(s.time + i * 0.15, () => s.damage('blade_dance', (BD_COEFF / 4) * mult, { tags: ['chaos'] }))
        }
        // Fel-Scarred: empowered Death Sweeps (2 per demon form, Eternal Hunt) surge
        if (metaUp(s) && s.stacks('player', 'demonsurge_deathsweep') > 0) {
          s.consumeStack('player', 'demonsurge_deathsweep')
          demonsurge(s)
        }
        cycleOfHatred(s)
      },
    },
    {
      id: 'felblade',
      name: 'Felblade',
      icon: 'ability_demonhunter_felblade',
      spellId: 232893,
      cooldown: 15,
      onResolve: (s) => {
        s.damage('felblade', FELBLADE_COEFF, { tags: ['fire'] })
        s.gain(40, 'felblade')
      },
    },
    {
      id: 'eye_beam',
      name: 'Eye Beam',
      icon: 'ability_demonhunter_eyebeam',
      spellId: 198013,
      cost: 30,
      cooldown: 40,
      displayName: (s) => (s.auraRemains('player', 'abyssal_gaze') > 0 ? 'Abyssal Gaze' : 'Eye Beam'),
      displayIcon: (s) => (s.auraRemains('player', 'abyssal_gaze') > 0 ? 'spell_shadow_evileye' : 'ability_demonhunter_eyebeam'),
      onCastStart: (s) => {
        // Demonic Intensity: Metamorphosis empowers Eye Beam into Abyssal Gaze
        if (s.auraRemains('player', 'abyssal_gaze') > 0) {
          s.removeAura('player', 'abyssal_gaze')
          s.data.abyssal = 1
          demonsurge(s) // the empowered cast detonates a Demonsurge
        } else {
          s.data.abyssal = 0
        }
      },
      channel: {
        duration: 2.0,
        ticks: 4,
        hasted: true,
        onTick: (s, i) => {
          const empowered = (s.data.abyssal ?? 0) === 1
          s.damage(empowered ? 'abyssal_gaze' : 'eye_beam', empowered ? ABYSSAL_TICK : EYE_BEAM_TICK, { tags: ['chaos'] })
          if (i === 4) {
            // Demonic: demon form follows; in 12.1 an Abyssal Gaze that
            // triggers Demonic generates a fresh set of Demonsurge procs
            grantDemonic(s)
            s.applyAura('player', 'furious_gaze')
          }
        },
      },
      onResolve: () => {},
    },
    {
      id: 'essence_break',
      name: 'Essence Break',
      icon: 'spell_shadow_ritualofsacrifice',
      spellId: 258860,
      cooldown: 40,
      onResolve: (s) => {
        s.damage('essence_break', EB_COEFF, { tags: ['chaos'] })
        s.applyAura('target', 'essence_break')
      },
    },
    {
      id: 'immolation_aura',
      name: 'Immolation Aura',
      icon: 'ability_demonhunter_immolation',
      spellId: 258920,
      cooldown: 30,
      charges: 2, // A Fire Inside
      displayName: (s) => (s.auraRemains('player', 'consuming_fire') > 0 ? 'Consuming Fire' : 'Immolation Aura'),
      displayIcon: (s) => (s.auraRemains('player', 'consuming_fire') > 0 ? 'spell_fire_incinerate' : 'ability_demonhunter_immolation'),
      onResolve: (s) => {
        // Demonic Intensity: Metamorphosis empowers Immolation Aura into Consuming Fire
        if (s.auraRemains('player', 'consuming_fire') > 0) {
          s.removeAura('player', 'consuming_fire')
          s.damage('consuming_fire', CF_INITIAL, { tags: ['fire'] })
          demonsurge(s)
        } else {
          s.damage('immolation_aura', IMMO_INITIAL, { tags: ['fire'] })
        }
        s.gain(20, 'immolation_aura')
        s.applyAura('player', 'immolation_aura')
      },
    },
    {
      id: 'the_hunt',
      name: 'The Hunt',
      icon: 'ability_ardenweald_demonhunter',
      spellId: 370965,
      cooldown: 90,
      onResolve: (s) => {
        s.damage('the_hunt', HUNT_HIT, { tags: ['nature'] })
        for (let i = 1; i <= 6; i++) {
          s.schedule(s.time + i, () => s.damage('the_hunt', HUNT_PULSE, { tags: ['nature'] }))
        }
      },
    },
    {
      id: 'metamorphosis',
      name: 'Metamorphosis',
      icon: 'ability_demonhunter_metamorphasisdps',
      spellId: 191427,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => {
        const wasUp = metaUp(s)
        s.applyAura('player', 'metamorphosis', { duration: 20 })
        if (!wasUp) demonsurge(s) // entering demon form induces a Demonsurge
        grantSurges(s)
        // Demonic Intensity: empower Eye Beam and Immolation Aura; the
        // empowered Abyssal Gaze is castable right away (Method's opener
        // goes Metamorphosis -> Consuming Fire -> Abyssal Gaze)
        s.applyAura('player', 'abyssal_gaze')
        s.applyAura('player', 'consuming_fire')
        s.resetCooldown('eye_beam')
        // A Fire Inside: Metamorphosis refunds Immolation Aura charges (APPROX: full reset)
        s.resetCooldown('immolation_aura')
      },
    },
  ],

  actionBar: [
    'chaos_strike', 'blade_dance', 'felblade', 'eye_beam',
    'essence_break', 'immolation_aura', 'the_hunt', 'metamorphosis',
  ],

  damageMult: (s) => (metaUp(s) ? META_DMG : 1),
  hasteMod: (s) => (s.auraRemains('player', 'furious_gaze') > 0 ? FURIOUS_GAZE_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'eye_beam': return s.auraRemains('player', 'abyssal_gaze') > 0 && s.cooldownRemains('eye_beam') === 0
      case 'immolation_aura': return s.auraRemains('player', 'consuming_fire') > 0 && s.chargesOf('immolation_aura') > 0
      case 'blade_dance': return metaUp(s) && s.stacks('player', 'demonsurge_deathsweep') > 0
      case 'chaos_strike': return metaUp(s) && s.stacks('player', 'demonsurge_annihilation') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'metamorphosis', text: 'Off-GCD when Eye Beam and Death Sweep are down and Immolation charges are drained — refunds charges, arms Abyssal Gaze + Consuming Fire', when: s => s.cooldownRemains('metamorphosis') === 0 && s.cooldownRemains('eye_beam') > 0 && s.cooldownRemains('blade_dance') > 0 && s.chargesOf('immolation_aura') < 2 },
    { abilityId: 'immolation_aura', text: 'Never sit at 2 charges (A Fire Inside) — spend before Metamorphosis', when: s => s.chargesOf('immolation_aura') === 2 },
    { abilityId: 'immolation_aura', text: 'Consuming Fire: spend the Metamorphosis empowerment — surges on cast', label: 'Consuming Fire', icon: 'spell_fire_incinerate', when: s => s.auraRemains('player', 'consuming_fire') > 0 && s.chargesOf('immolation_aura') > 0 },
    { abilityId: 'essence_break', text: 'On cooldown with 60+ Fury — spend Death Sweep/Annihilation inside it (S2 4pc: 6s window)', when: s => s.cooldownRemains('essence_break') === 0 },
    { abilityId: 'eye_beam', text: 'On cooldown with 30+ Fury — Demonic + Demonsurge procs; Abyssal Gaze when empowered', when: s => s.cooldownRemains('eye_beam') === 0 },
    { abilityId: 'blade_dance', text: 'Death Sweep with a Demonsurge charge — 2 per demon form (Eternal Hunt)', when: s => metaUp(s) && s.stacks('player', 'demonsurge_deathsweep') > 0 && s.cooldownRemains('blade_dance') === 0 },
    { abilityId: 'chaos_strike', text: 'Annihilation with a Demonsurge charge — consume it inside demon form', when: s => metaUp(s) && s.stacks('player', 'demonsurge_annihilation') > 0 },
    { abilityId: 'the_hunt', text: 'On cooldown', when: s => s.cooldownRemains('the_hunt') === 0 },
    { abilityId: 'blade_dance', text: 'On cooldown (First Blood), especially inside Essence Break', when: s => s.cooldownRemains('blade_dance') === 0 },
    { abilityId: 'immolation_aura', text: 'Filler charge, unless it would overcap Fury', when: s => s.chargesOf('immolation_aura') > 0 },
    { abilityId: 'felblade', text: 'Fury generator — use below ~75 Fury', when: s => s.cooldownRemains('felblade') === 0 },
    { abilityId: 'chaos_strike', text: 'Spender — never cap Fury; pool briefly before Essence Break' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Eye Beam / Abyssal Gaze
    const fury = s.insanity
    const eyeCd = s.cooldownRemains('eye_beam')
    const bdCd = s.cooldownRemains('blade_dance')
    const ebCd = s.cooldownRemains('essence_break')
    const ebUp = s.auraRemains('target', 'essence_break') > 0
    const immoCharges = s.chargesOf('immolation_aura')
    const cfArmed = s.auraRemains('player', 'consuming_fire') > 0
    const dsSurge = metaUp(s) && s.stacks('player', 'demonsurge_deathsweep') > 0
    const anniSurge = metaUp(s) && s.stacks('player', 'demonsurge_annihilation') > 0
    const pooling = ebCd < 6 && !ebUp && fury < 90

    if (s.cooldownRemains('metamorphosis') === 0 && eyeCd > 0 && bdCd > 0 && immoCharges < 2) return 'metamorphosis'
    if (immoCharges === 2) return 'immolation_aura'
    if (cfArmed && immoCharges > 0) return 'immolation_aura' // Consuming Fire
    if (ebCd === 0 && fury >= 60) return 'essence_break'
    if (eyeCd === 0 && fury >= 30) return 'eye_beam' // Abyssal Gaze when empowered
    if (dsSurge && bdCd === 0 && fury >= 35) return 'blade_dance' // Death Sweep surge
    if (anniSurge && fury >= 40) return 'chaos_strike' // Annihilation surge
    if (s.cooldownRemains('the_hunt') === 0) return 'the_hunt'
    if (ebUp) {
      if (bdCd === 0 && fury >= 35) return 'blade_dance'
      if (fury >= 40) return 'chaos_strike'
      if (s.cooldownRemains('felblade') === 0) return 'felblade'
    }
    if (immoCharges > 0 && fury <= 95) return 'immolation_aura'
    if (s.cooldownRemains('felblade') === 0 && fury <= 75) return 'felblade'
    if (!pooling && bdCd === 0 && fury >= 35) return 'blade_dance'
    if (!pooling && fury >= 40) return 'chaos_strike'
    return null // wait for Fury
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const spenders = ['chaos_strike', 'blade_dance']
    const generators = ['felblade', 'immolation_aura']
    const sets = [spenders, generators]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
