import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Devourer Demon Hunter — patch 12.1.0 (Midnight, Season 2). The third DH
 * spec added in Midnight: a mid-range (25yd) Intellect Void caster that
 * gathers Soul Fragments and detonates them from within Void Metamorphosis.
 * Void-Scarred raid single-target build. Verified 2026-08-24 against:
 * - Wowhead: Devourer DH Rotation Guide (Midnight)
 *   https://www.wowhead.com/guide/classes/demon-hunter/devourer/rotation-cooldowns-pve-dps
 * - Icy Veins: Devourer DH Rotation/Easy Mode/Talents 12.1
 *   https://www.icy-veins.com/wow/devourer-demon-hunter-pve-dps-rotation-cooldowns-abilities
 * - Method: Devourer DH Playstyle & Rotation, Midnight 12.1
 *   https://www.method.gg/guides/devourer-demon-hunter/playstyle-and-rotation
 *
 * Live kit as modeled (all coefficients APPROX, in AP units):
 * - Fury (max 140 with Void-Scarred): built by Consume, Reap harvests, and
 *   Soul Immolation; dumped into the Void Ray channel at 100 Fury (a full
 *   channel resets Reap and spawns Fragments — Waste Not).
 * - Soul Fragments: spawned by Consume (2), Soul Immolation (3), and Void
 *   Ray (3); Reap harvests everything out — damage per Fragment, Fury per
 *   Fragment, and the harvest is banked as Souls.
 * - Souls: 50 banked Souls unlock Void Metamorphosis (Consume -> Devour,
 *   Reap -> Cull); inside it, Collapsing Star burns 30 Souls per cast and
 *   always crits (Midnight Apex).
 * - Voidfall (3 stacks, from Consume 35% / full Void Ray): consumed by the
 *   next Reap for bonus damage.
 * - Soulburst: proc on a 4+ Fragment Reap (S2 2pc; chance scales with crit
 *   here, APPROX) — the next Consume/Devour explodes, spawns 2 Fragments
 *   and grants Moment of Craving (S2 4pc, +10% damage).
 * APPROX / unmodeled: spell ids are placeholders (new spec, undatamined
 * here); Void Meta Fury drain, Voidblade/Hungering Slash/Voidstep movement
 * micro and the deeper Void-Scarred proc layer (Voidsurge) are folded into
 * flat coefficients; The Hunt kept as a simple charge + pulses.
 */

const CONSUME_COEFF = 0.55
const DEVOUR_COEFF = 0.95
const CONSUME_FURY = 20
const DEVOUR_FURY = 25
const CONSUME_FRAGS = 2
const DEVOUR_FRAGS = 3
const VOIDFALL_CHANCE = 0.35     // Consume's chance to grant a Voidfall stack
const SOULBURST_COEFF = 1.1
const SOULBURST_FRAGS = 2        // S2 4pc
const REAP_BASE = 0.8
const CULL_BASE = 1.15
const REAP_PER_FRAG = 0.22
const REAP_TIER_MULT = 1.10      // S2 4pc: Reap deals +10%
const VOIDFALL_AMP = 0.35        // Reap bonus per Voidfall stack consumed
const REAP_FURY_PER_FRAG = 4
const SOULBURST_CHANCE = 0.20    // S2 2pc, on a 4+ Fragment Reap (+crit, APPROX)
const IMMO_INITIAL = 0.35
const IMMO_TICK = 0.30
const IMMO_TICK_FURY = 3
const IMMO_FRAGS = 3
const RAY_TICK = 0.55            // 5 ticks
const RAY_COST = 100
const RAY_FRAGS = 3              // Waste Not: full channel spawns Fragments
const STAR_COEFF = 3.2
const STAR_SOULS = 30
const META_SOULS = 50
const META_DMG = 1.10            // Void Metamorphosis empowerment (APPROX)
const MOC_AMP = 1.10             // Moment of Craving (S2 4pc)
const HUNT_HIT = 1.8
const HUNT_PULSE = 0.3           // 6 scheduled pulses (not a debuff aura)

function metaUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'void_metamorphosis') > 0
}

function souls(s: SimAPI): number {
  return s.stacks('player', 'devoured_souls')
}

function spawnFrags(s: SimAPI, n: number) {
  if (n > 0) s.applyAura('player', 'soul_fragments', { stacks: n })
}

function bankSouls(s: SimAPI, n: number) {
  if (n > 0) s.applyAura('player', 'devoured_souls', { stacks: n })
}

function spendSouls(s: SimAPI, n: number) {
  const a = s.aura('player', 'devoured_souls')
  if (!a) return
  a.stacks -= n
  if (a.stacks <= 0) s.removeAura('player', 'devoured_souls')
}

export const devourerDH: SpecConfig = {
  name: 'Devourer Demon Hunter',
  specId: 'dh-devourer',
  specIcon: 'spell_shadow_devouringplague',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/demon-hunter/devourer/rotation-cooldowns-pve-dps',
    buildName: 'Void-Scarred Raid / Single Target',
    heroTalent: 'Void-Scarred',
    // Icy Veins 12.1 "Devourer Single Target - Void-Scarred" import code
    talentString: 'CgcBAAAAAAAAAAAAAAAAAAAAAAAWMzMzMzMjBmBAAAAAAY5BGz2gZAAAAAAAAYGzw8AzMzMzMzMjZ2mZM202CACYAMmZmtZmpZbmlZmxYGA',
    retrieved: '2026-08-24',
  },
  resourceName: 'Fury',
  resourceMax: 140,
  startingResource: 0,

  auras: [
    { id: 'soul_fragments', name: 'Soul Fragments', icon: 'spell_shadow_soulgem', duration: 25, maxStacks: 8 },
    { id: 'devoured_souls', name: 'Souls', icon: 'spell_shadow_gathershadows', duration: Infinity, maxStacks: 50 },
    { id: 'voidfall', name: 'Voidfall', icon: 'inv_cosmicvoid_debuff', duration: 20, maxStacks: 3 },
    { id: 'soulburst', name: 'Soulburst', icon: 'spell_shadow_seedofdestruction', duration: 12 },
    { id: 'moment_of_craving', name: 'Moment of Craving', icon: 'inv_artifact_stolenpower', duration: 8 },
    { id: 'void_metamorphosis', name: 'Void Metamorphosis', icon: 'ability_demonhunter_metamorphasisdps', duration: 20 },
    {
      id: 'soul_immolation', name: 'Soul Immolation', icon: 'spell_fire_felimmolation', duration: 12,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          s.damage('soul_immolation', IMMO_TICK, { tags: ['fire', 'shadow'] })
          s.gain(IMMO_TICK_FURY, 'soul_immolation')
        },
      },
    },
  ],

  abilities: [
    {
      id: 'consume',
      name: 'Consume',
      icon: 'ability_demonhunter_consumemagic',
      spellId: 1250001, // APPROX placeholder — new spec, id not datamined here
      displayName: (s) => (metaUp(s) ? 'Devour' : 'Consume'),
      displayIcon: (s) => (metaUp(s) ? 'ability_bossgorefiend_touchofdoom' : 'ability_demonhunter_consumemagic'),
      onResolve: (s) => {
        const inMeta = metaUp(s)
        if (s.auraRemains('player', 'soulburst') > 0) {
          s.removeAura('player', 'soulburst')
          s.damage('soulburst', SOULBURST_COEFF, { tags: ['shadow'] })
          spawnFrags(s, SOULBURST_FRAGS)              // S2 4pc
          s.applyAura('player', 'moment_of_craving')  // S2 4pc
        }
        s.damage(inMeta ? 'devour' : 'consume', inMeta ? DEVOUR_COEFF : CONSUME_COEFF, { tags: ['shadow'] })
        s.gain(inMeta ? DEVOUR_FURY : CONSUME_FURY, 'consume')
        spawnFrags(s, inMeta ? DEVOUR_FRAGS : CONSUME_FRAGS)
        if (s.rng('voidfall') < VOIDFALL_CHANCE) s.applyAura('player', 'voidfall', { stacks: 1 })
      },
    },
    {
      id: 'reap',
      name: 'Reap',
      icon: 'ability_demonhunter_soulcleave2',
      spellId: 1250004, // APPROX placeholder
      cooldown: 8,
      displayName: (s) => (metaUp(s) ? 'Cull' : 'Reap'),
      displayIcon: (s) => (metaUp(s) ? 'ability_demonhunter_soulcleave4' : 'ability_demonhunter_soulcleave2'),
      onResolve: (s) => {
        const inMeta = metaUp(s)
        const frags = s.stacks('player', 'soul_fragments')
        const vf = s.stacks('player', 'voidfall')
        if (frags > 0) s.removeAura('player', 'soul_fragments')
        if (vf > 0) s.removeAura('player', 'voidfall')
        const base = inMeta ? CULL_BASE : REAP_BASE
        s.damage(inMeta ? 'cull' : 'reap',
          (base + REAP_PER_FRAG * frags) * (1 + VOIDFALL_AMP * vf) * REAP_TIER_MULT,
          { tags: ['shadow'] })
        s.gain(REAP_FURY_PER_FRAG * frags, 'reap')
        bankSouls(s, frags)
        // S2 2pc: a 4+ Fragment harvest can prime a Soulburst (crit-scaling, APPROX)
        if (frags >= 4 && s.rng('soulburst') < Math.min(1, SOULBURST_CHANCE + s.stats.critChance)) {
          s.applyAura('player', 'soulburst')
        }
      },
    },
    {
      id: 'soul_immolation',
      name: 'Soul Immolation',
      icon: 'spell_fire_felimmolation',
      spellId: 1250007, // APPROX placeholder
      cooldown: 30,
      onResolve: (s) => {
        s.damage('soul_immolation', IMMO_INITIAL, { tags: ['fire', 'shadow'] })
        spawnFrags(s, IMMO_FRAGS)
        s.applyAura('player', 'soul_immolation')
      },
    },
    {
      id: 'void_ray',
      name: 'Void Ray',
      icon: 'spell_priest_void-blast',
      spellId: 1250010, // APPROX placeholder
      cost: RAY_COST,
      channel: {
        duration: 2.0,
        ticks: 5,
        hasted: true,
        onTick: (s, i) => {
          s.damage('void_ray', RAY_TICK, { tags: ['shadow'] })
          if (i === 5) {
            // full channel: resets Reap, guarantees Voidfall, spawns Fragments (Waste Not)
            s.resetCooldown('reap')
            s.applyAura('player', 'voidfall', { stacks: 1 })
            spawnFrags(s, RAY_FRAGS)
          }
        },
      },
      onResolve: () => {},
    },
    {
      id: 'void_metamorphosis',
      name: 'Void Metamorphosis',
      icon: 'ability_demonhunter_metamorphasisdps',
      spellId: 1250013, // APPROX placeholder
      cooldown: 60,
      offGcd: true,
      usable: (s) => (souls(s) >= META_SOULS ? true : `requires ${META_SOULS} Souls`),
      onResolve: (s) => s.applyAura('player', 'void_metamorphosis'),
    },
    {
      id: 'collapsing_star',
      name: 'Collapsing Star',
      icon: 'inv_cosmicvoid_nova',
      spellId: 1250016, // APPROX placeholder
      usable: (s) => {
        if (!metaUp(s)) return 'requires Void Metamorphosis'
        if (souls(s) < STAR_SOULS) return `requires ${STAR_SOULS} Souls`
        return true
      },
      onResolve: (s) => {
        spendSouls(s, STAR_SOULS)
        // Midnight Apex: Collapsing Star always crits
        s.damage('collapsing_star', STAR_COEFF * s.stats.critMult, { canCrit: false, tags: ['shadow'] })
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
  ],

  actionBar: [
    'consume', 'reap', 'void_ray', 'soul_immolation',
    'collapsing_star', 'void_metamorphosis', 'the_hunt',
  ],

  damageMult: (s) => {
    let m = 1
    if (metaUp(s)) m *= META_DMG
    if (s.auraRemains('player', 'moment_of_craving') > 0) m *= MOC_AMP
    return m
  },

  glows: (s, id) => {
    switch (id) {
      case 'consume': return s.auraRemains('player', 'soulburst') > 0
      case 'reap': return s.cooldownRemains('reap') === 0 && s.stacks('player', 'soul_fragments') >= 4
      case 'void_metamorphosis': return s.cooldownRemains('void_metamorphosis') === 0 && souls(s) >= META_SOULS
      case 'collapsing_star': return metaUp(s) && souls(s) >= STAR_SOULS
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'consume', text: 'Soulburst proc: consume it now — explodes, spawns Fragments, Moment of Craving (4pc)', when: s => s.auraRemains('player', 'soulburst') > 0 },
    { abilityId: 'reap', text: 'On cooldown with 4+ Soul Fragments out — harvest (Voidfall amps it)', when: s => s.cooldownRemains('reap') === 0 && s.stacks('player', 'soul_fragments') >= 4 },
    { abilityId: 'soul_immolation', text: 'On cooldown if not already burning — Fragments + Fury over time', when: s => s.cooldownRemains('soul_immolation') === 0 && s.auraRemains('player', 'soul_immolation') <= 0 },
    { abilityId: 'the_hunt', text: 'On cooldown', when: s => s.cooldownRemains('the_hunt') === 0 },
    { abilityId: 'void_metamorphosis', text: 'Off-GCD at 50 Souls — Consume becomes Devour, Reap becomes Cull', when: s => s.cooldownRemains('void_metamorphosis') === 0 && souls(s) >= META_SOULS },
    { abilityId: 'void_ray', text: 'Channel at 100 Fury — never clip; a full channel resets Reap', when: s => s.insanity >= RAY_COST },
    { abilityId: 'collapsing_star', text: 'Inside Void Metamorphosis at 30+ Souls — always crits (Midnight Apex)', when: s => metaUp(s) && souls(s) >= STAR_SOULS },
    { abilityId: 'consume', text: 'Filler — Fury, Soul Fragments, chance of Voidfall' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Void Ray
    const fury = s.insanity
    const frags = s.stacks('player', 'soul_fragments')
    const burst = s.auraRemains('player', 'soulburst') > 0

    if (metaUp(s)) {
      if (burst) return 'consume' // Devour the Soulburst
      if (fury >= RAY_COST) return 'void_ray'
      if (s.cooldownRemains('reap') === 0 && frags >= 4) return 'reap' // Cull
      if (souls(s) >= STAR_SOULS) return 'collapsing_star'
      return 'consume' // Devour filler
    }
    if (burst) return 'consume'
    if (s.cooldownRemains('reap') === 0 && frags >= 4) return 'reap'
    if (s.cooldownRemains('soul_immolation') === 0 && s.auraRemains('player', 'soul_immolation') <= 0) return 'soul_immolation'
    if (s.cooldownRemains('the_hunt') === 0) return 'the_hunt'
    if (s.cooldownRemains('void_metamorphosis') === 0 && souls(s) >= META_SOULS) return 'void_metamorphosis'
    if (fury >= RAY_COST) return 'void_ray'
    return 'consume'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const builders = ['consume', 'soul_immolation']
    const spenders = ['void_ray', 'collapsing_star']
    const sets = [builders, spenders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
