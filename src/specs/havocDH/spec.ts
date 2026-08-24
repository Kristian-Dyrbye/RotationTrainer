import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Havoc Demon Hunter — patch 12.1.0 (Midnight, Season 2), Aldrachi Reaver
 * raid single-target build. Verified 2026-08-24 against:
 * - Wowhead: Havoc DH Rotation Guide (Midnight)
 *   https://www.wowhead.com/guide/classes/demon-hunter/havoc/rotation-cooldowns-pve-dps
 * - Icy Veins: Havoc DH Rotation/Talents 12.1
 *   https://www.icy-veins.com/wow/havoc-demon-hunter-pve-dps-rotation-cooldowns-abilities
 * - Method: Havoc DH Playstyle & Rotation, Midnight 12.1
 *   https://www.method.gg/guides/havoc-demon-hunter/playstyle-and-rotation
 *
 * S2 meta: Aldrachi Reaver overtook Fel-Scarred for raid ST. Core loop:
 * Eye Beam into Demonic, spend on Death Sweep/Annihilation, Essence Break +
 * Metamorphosis + The Hunt as burst; cast Reaver's Glaive when charged and
 * follow with Chaos Strike to apply Reaver's Mark.
 *
 * Resource model: Fury (max 120). DW auto-attacks with Demon Blades
 * (chance per swing to strike again and generate Fury — flat-chance
 * stand-in for the RPPM model, APPROX).
 * Talent assumptions: Demon Blades, First Blood, Demonic, Essence Break,
 * The Hunt, Cycle of Hatred (spenders tick down Eye Beam — APPROX flat
 * CDR), Aldrachi Reaver simplified: every 6th Chaos Strike/Blade Dance
 * charges a Reaver's Glaive; The Hunt charges one instantly. Casting the
 * glaive empowers the next Chaos Strike (+50%, applies Reaver's Mark, +6%
 * damage taken). Apex: Fel Ascendance 3/3 — Chaos Strikes during
 * Metamorphosis extend it 0.5s, 8 times.
 * S2 tier (Abyssal Doomhound's Pursuit): 2pc Blade Dance/Chaos Strike/
 * Essence Break +12% (folded into coefficients); 4pc Essence Break +35%
 * initial hit, 6s window, and it benefits from Cycle of Hatred CDR.
 * APPROX-flagged: auto cadence, Demon Blades chance/Fury, Reaver cycle
 * pacing, Cycle of Hatred as flat per-cast CDR, Inertia/Exergy movement
 * micro (Vengeful Retreat/Fel Rush) not modeled on the training dummy.
 * Damage in AP units.
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
const EB_COEFF = 1.95            // incl. S2 2pc +12% and 4pc +35% initial hit
const EB_AMP = 1.4               // Essence Break amp on Chaos Strike/Blade Dance
const EB_DURATION = 6            // 4s + 2s from S2 4pc
const IMMO_INITIAL = 0.5
const IMMO_TICK = 0.19
const HUNT_HIT = 1.9
const HUNT_PULSE = 0.35          // 6 scheduled pulses (not a debuff aura)
const META_DMG = 1.2
const FURIOUS_GAZE_HASTE = 0.10
const GLAIVE_COEFF = 1.3
const ART_MULT = 1.5             // Art of the Glaive: empowered Chaos Strike
const REAVERS_MARK_AMP = 1.06
const COH_EYE_CDR = 1.0          // Cycle of Hatred per spender cast (APPROX)
const COH_EB_CDR = 0.5           // S2 4pc: Essence Break rides Cycle of Hatred

function metaUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'metamorphosis') > 0
}

/** Aldrachi Reaver (simplified): every 6th finisher charges a Reaver's Glaive */
function reaverHit(s: SimAPI) {
  s.data.reaver_hits = (s.data.reaver_hits ?? 0) + 1
  if (s.data.reaver_hits >= 6) {
    s.data.reaver_hits -= 6
    s.applyAura('player', 'reavers_glaive')
  }
}

/** Cycle of Hatred: Fury spenders tick down Eye Beam (and Essence Break, S2 4pc) */
function cycleOfHatred(s: SimAPI) {
  s.reduceCooldown('eye_beam', COH_EYE_CDR)
  s.reduceCooldown('essence_break', COH_EB_CDR)
}

/** Demonic: Eye Beam grants (or extends) a short Metamorphosis */
function grantDemonic(s: SimAPI) {
  if (metaUp(s)) s.extendAura('player', 'metamorphosis', 4)
  else s.applyAura('player', 'metamorphosis', { duration: 6 })
}

export const havocDH: SpecConfig = {
  name: 'Havoc Demon Hunter',
  specId: 'dh-havoc',
  specIcon: 'ability_demonhunter_specdps',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/demon-hunter/havoc/rotation-cooldowns-pve-dps',
    buildName: 'Aldrachi Reaver Raid / Single Target',
    heroTalent: 'Aldrachi Reaver',
    // Icy Veins 12.1 "Raid / Single Target - Aldrachi Reaver" import code
    talentString: 'CEkAAAAAAAAAAAAAAAAAAAAAAYgZmZMjZmZmxMZMzAAAAAAAmNjZbmxYmtZmxyMjZsMzwMLzsMDGGLbMhxMjhFAAAAAAAwMDwAAAAwA',
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
    { id: 'reavers_glaive', name: "Reaver's Glaive", icon: 'inv_ability_aldrachireaverdemonhunter_reaversglaive', duration: 30 },
    { id: 'art_of_the_glaive', name: 'Art of the Glaive', icon: 'inv_glaive_1h_npc_d_02', duration: 12 },
    { id: 'reavers_mark', name: "Reaver's Mark", icon: 'ability_demonhunter_hatefulstrike', duration: 15, debuff: true },
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
      onResolve: (s) => {
        let mult = s.auraRemains('target', 'essence_break') > 0 ? EB_AMP : 1
        if (s.auraRemains('player', 'art_of_the_glaive') > 0) {
          s.removeAura('player', 'art_of_the_glaive')
          mult *= ART_MULT
          s.applyAura('target', 'reavers_mark')
        }
        s.damage('chaos_strike', CS_COEFF * mult, { tags: ['chaos'] })
        // refund chance equals your crit chance (+ Critical Chaos): scales with the crit stat
        if (s.rng('chaos_refund') < Math.min(1, s.stats.critChance + CRITICAL_CHAOS)) s.gain(20, 'chaos_refund')
        reaverHit(s)
        cycleOfHatred(s)
        // Apex: Fel Ascendance — Chaos Strikes extend Metamorphosis 0.5s, 8×
        const meta = s.aura('player', 'metamorphosis')
        if (meta && (meta.data.ext ?? 0) < 8) {
          meta.data.ext = (meta.data.ext ?? 0) + 1
          s.extendAura('player', 'metamorphosis', 0.5)
        }
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
      onResolve: (s) => {
        const mult = s.auraRemains('target', 'essence_break') > 0 ? EB_AMP : 1
        // 4 quick hits
        for (let i = 0; i < 4; i++) {
          s.schedule(s.time + i * 0.15, () => s.damage('blade_dance', (BD_COEFF / 4) * mult, { tags: ['chaos'] }))
        }
        reaverHit(s)
        cycleOfHatred(s)
      },
    },
    {
      id: 'reavers_glaive',
      name: "Reaver's Glaive",
      icon: 'inv_ability_aldrachireaverdemonhunter_reaversglaive',
      spellId: 442294,
      usable: (s) => (s.auraRemains('player', 'reavers_glaive') > 0 ? true : "no Reaver's Glaive charged"),
      onResolve: (s) => {
        s.removeAura('player', 'reavers_glaive')
        s.damage('reavers_glaive', GLAIVE_COEFF, { tags: ['physical'] })
        // Art of the Glaive: the next Chaos Strike is empowered and applies Reaver's Mark
        s.applyAura('player', 'art_of_the_glaive')
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
      channel: {
        duration: 2.0,
        ticks: 4,
        hasted: true,
        onTick: (s, i) => {
          s.damage('eye_beam', EYE_BEAM_TICK, { tags: ['chaos'] })
          if (i === 4) {
            grantDemonic(s) // Demonic: short Meta after the channel
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
      onResolve: (s) => {
        s.damage('immolation_aura', IMMO_INITIAL, { tags: ['fire'] })
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
        // Aldrachi Reaver: The Hunt charges a Reaver's Glaive
        s.applyAura('player', 'reavers_glaive')
      },
    },
    {
      id: 'metamorphosis',
      name: 'Metamorphosis',
      icon: 'ability_demonhunter_metamorphasisdps',
      spellId: 191427,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => s.applyAura('player', 'metamorphosis', { duration: 20 }),
    },
  ],

  actionBar: [
    'chaos_strike', 'blade_dance', 'reavers_glaive', 'felblade', 'eye_beam',
    'essence_break', 'immolation_aura', 'the_hunt', 'metamorphosis',
  ],

  damageMult: (s) => {
    let m = 1
    if (metaUp(s)) m *= META_DMG
    if (s.auraRemains('target', 'reavers_mark') > 0) m *= REAVERS_MARK_AMP
    return m
  },
  hasteMod: (s) => (s.auraRemains('player', 'furious_gaze') > 0 ? FURIOUS_GAZE_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'reavers_glaive': return s.auraRemains('player', 'reavers_glaive') > 0
      case 'chaos_strike': return s.auraRemains('player', 'art_of_the_glaive') > 0
      case 'eye_beam': return s.cooldownRemains('eye_beam') === 0 && s.insanity >= 30
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'metamorphosis', text: 'Off-GCD, when Eye Beam and Blade Dance are both on cooldown', when: s => s.cooldownRemains('metamorphosis') === 0 && s.cooldownRemains('eye_beam') > 0 && s.cooldownRemains('blade_dance') > 0 },
    { abilityId: 'reavers_glaive', text: 'When charged (every 6 finishers; The Hunt charges one)', when: s => s.auraRemains('player', 'reavers_glaive') > 0 },
    { abilityId: 'the_hunt', text: "On cooldown, after spending Reaver's Glaive", when: s => s.cooldownRemains('the_hunt') === 0 },
    { abilityId: 'chaos_strike', text: "Spend the glaive empowerment — +50% and applies Reaver's Mark", when: s => s.auraRemains('player', 'art_of_the_glaive') > 0 },
    { abilityId: 'eye_beam', text: 'On cooldown with 30+ Fury — Demonic window follows', when: s => s.cooldownRemains('eye_beam') === 0 },
    { abilityId: 'essence_break', text: 'With 60+ Fury; hold it if Eye Beam is <4s away (S2 4pc: 6s window)', when: s => s.cooldownRemains('essence_break') === 0 },
    { abilityId: 'blade_dance', text: 'On cooldown (First Blood), especially inside Essence Break', when: s => s.cooldownRemains('blade_dance') === 0 },
    { abilityId: 'immolation_aura', text: 'On cooldown, unless it would overcap Fury', when: s => s.cooldownRemains('immolation_aura') === 0 },
    { abilityId: 'felblade', text: 'Fury generator — use below ~75 Fury', when: s => s.cooldownRemains('felblade') === 0 },
    { abilityId: 'chaos_strike', text: 'Spender — never cap Fury; pool briefly before Essence Break' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Eye Beam
    const fury = s.insanity
    const eyeCd = s.cooldownRemains('eye_beam')
    const bdCd = s.cooldownRemains('blade_dance')
    const ebCd = s.cooldownRemains('essence_break')
    const ebUp = s.auraRemains('target', 'essence_break') > 0
    const empowered = s.auraRemains('player', 'art_of_the_glaive') > 0
    const pooling = ebCd < 6 && !ebUp && fury < 90

    if (s.cooldownRemains('metamorphosis') === 0 && eyeCd > 0 && bdCd > 0) return 'metamorphosis'
    if (s.auraRemains('player', 'reavers_glaive') > 0) return 'reavers_glaive'
    if (s.cooldownRemains('the_hunt') === 0) return 'the_hunt'
    if (empowered && fury >= 40) return 'chaos_strike'
    if (eyeCd === 0 && fury >= 30) return 'eye_beam'
    if (ebCd === 0 && fury >= 60 && (eyeCd > 4 || metaUp(s))) return 'essence_break'
    if (ebUp) {
      if (bdCd === 0 && fury >= 35) return 'blade_dance'
      if (fury >= 40) return 'chaos_strike'
      if (s.cooldownRemains('felblade') === 0) return 'felblade'
    }
    if (s.cooldownRemains('immolation_aura') === 0 && fury <= 95) return 'immolation_aura'
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
