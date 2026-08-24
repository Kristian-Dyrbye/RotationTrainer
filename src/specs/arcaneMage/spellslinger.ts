import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Arcane Mage — patch 12.1.0 (Midnight, Season 2), Spellslinger raid ST
 * build (alternate to the default Sunfury build in spec.ts).
 * Modeled from the Wowhead/Icy Veins/Method 12.1 guides (verified 2026-08-24):
 * - https://www.wowhead.com/guide/classes/mage/arcane/rotation-cooldowns-pve-dps
 * - https://www.icy-veins.com/wow/arcane-mage-pve-dps-rotation-cooldowns-abilities
 * - https://www.method.gg/guides/arcane-mage/playstyle-and-rotation
 *
 * Spellslinger differences vs Sunfury (all per the 12.1 guides):
 * - Arcane Salvo caps at 20 (not 25): Barrage dumps at 4 charges + 20 Salvo
 *   (Polished Focus: 20+ Salvo Barrages hit 15% harder and refund 3 stacks),
 *   or at 12+ Salvo while holding a Clearcasting proc. Arcane Missiles only
 *   under 15 Salvo (Icy Veins rows; Wowhead's prose carries the same numbers).
 * - No Arcane Soul / Arcane Phoenix — those are Sunfury. Instead the tree
 *   conjures Arcane Splinters: Splintering Sorcery (Arcane Blast conjures 1),
 *   Shifting Shards (gaining Clearcasting conjures 2), Splintering Orbs
 *   (Arcane Orb conjures 2 and hits 50% harder). Splinterstorm was redesigned
 *   in 12.0: casting Arcane Surge conjures a burst of 8 Arcane Splinters, and
 *   during Arcane Surge the chance to conjure an additional Splinter is 100%
 *   (modeled as doubled conjuring). Augury Abounds: conjuring Splinters has a
 *   10% chance to conjure a burst of 8. Splinters no longer apply a DoT.
 * - Prismatic Bolt is fired without Clearcasting or at 6+ Cumulative Power
 *   (Method holds only to 6 for Spellslinger, vs 8 on Sunfury).
 * S2 tier: 2pc Arcane Missiles fires a 7th wave and +5% damage; 4pc each
 * wave grants Cumulative Power (+3% next Prismatic Bolt / Arcane Blast,
 * cap 8 stacks / 24%).
 * Icy Veins publishes no Spellslinger export string on its 12.1 builds page,
 * so talentString is omitted.
 * APPROX-flagged: Clearcasting rate, Prismatic proc chance per Salvo stack
 * (~2%/stack consumed), splinter coefficient and travel, Polished Focus
 * numbers folded per guide text. Damage in SP units.
 */

const AB_COEFF = 0.95
const AB_PER_CHARGE = 0.55
const BARRAGE_COEFF = 0.65
const BARRAGE_PER_CHARGE = 0.40
const BARRAGE_PER_SALVO = 0.04    // APPROX: Salvo "significantly" buffs Barrage
const POLISHED_FOCUS_MULT = 1.15  // 12.1: 20+ Salvo Barrage +15% (Polished Focus)
const POLISHED_FOCUS_REFUND = 3   // 12.1: refunds 3 Salvo stacks
const MISSILE_TICK = 0.36         // 7 waves (S2 2pc), incl. 2pc +5%
const ORB_COEFF = 1.30 * 1.5      // Splintering Orbs: Arcane Orb +50%
const PRISMATIC_COEFF = 3.2       // APPROX: "by far your highest damaging ability"
const PRISMATIC_PER_SALVO = 0.02  // APPROX: ~40% at a 20-Salvo dump
const CP_PER_STACK = 0.03         // S2 4pc: Cumulative Power
const TOUCH_HIT = 0.50
const TOUCH_PCT = 0.20
const SURGE_COEFF = 5.8
const SURGE_BUFF = 1.35           // 12.1: +35% spell damage for 15s
const CC_CHANCE = 0.25            // APPROX: Clearcasting per Arcane Blast
const SPLINTER_COEFF = 0.15      // APPROX: Arcane Splinter bolt
const AUGURY_CHANCE = 0.10       // 12.1: conjuring can burst 8 more

/**
 * All arcane damage funnels through here so Touch of the Magi can bank
 * 20% of everything dealt inside its window (expected-value, APPROX).
 */
function arcaneDamage(s: SimAPI, id: string, coeff: number, opts?: { canCrit?: boolean }) {
  s.damage(id, coeff, { ...opts, tags: ['arcane'] })
  const touch = s.aura('target', 'touch_of_the_magi')
  if (touch) {
    const canCrit = opts?.canCrit ?? true
    const expected = canCrit ? coeff * (1 + s.stats.critChance * (s.stats.critMult - 1)) : coeff
    touch.data.bank = (touch.data.bank ?? 0) + expected
  }
}

/**
 * Spellslinger: conjure Arcane Splinters. Doubled during Arcane Surge
 * (Splinterstorm's 100% extra-Splinter chance); Augury Abounds can burst 8.
 */
function conjureSplinters(s: SimAPI, n: number) {
  let count = n
  if (s.auraRemains('player', 'arcane_surge') > 0) count *= 2
  if (s.rng('augury') < AUGURY_CHANCE) count += 8
  for (let i = 0; i < count; i++) {
    s.schedule(s.time + 0.5 + i * 0.1, () => {
      arcaneDamage(s, 'Arcane Splinter', SPLINTER_COEFF)
    })
  }
}

export const arcaneMageSpellslinger: SpecConfig = {
  name: 'Arcane Mage',
  specId: 'mage-arcane',
  specIcon: 'spell_holy_magicalsentry',
  buildId: 'spellslinger',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/mage/arcane/rotation-cooldowns-pve-dps',
    buildName: 'Arcane Raid — Spellslinger (Icy Veins/Method 12.1 alternate)',
    heroTalent: 'Spellslinger',
    // Icy Veins' 12.1 builds page publishes export strings only for Sunfury —
    // no Spellslinger string is published, so none is quoted here.
    retrieved: '2026-08-24',
  },
  resourceName: 'Arcane Charges',
  resourceMax: 4,
  startingResource: 0,

  auras: [
    { id: 'clearcasting', name: 'Clearcasting', icon: 'spell_shadow_manaburn', duration: 20, maxStacks: 3 },
    // Spellslinger: Salvo caps at 20 (Sunfury's Intuition pushes it to 25)
    { id: 'arcane_salvo', name: 'Arcane Salvo', icon: 'spell_arcane_arcane01', duration: 40, maxStacks: 20 },
    { id: 'cumulative_power', name: 'Cumulative Power', icon: 'spell_arcane_arcanepotency', duration: 30, maxStacks: 8 },
    { id: 'prismatic_bolt', name: 'Prismatic Bolt', icon: 'inv_enchant_prismaticsphere', duration: 30 },
    { id: 'arcane_surge', name: 'Arcane Surge', icon: 'ability_mage_arcanesurge', duration: 15 },
    {
      id: 'touch_of_the_magi', name: 'Touch of the Magi', icon: 'spell_arcane_arcane02',
      duration: 12, debuff: true,
      onExpire: (s, aura) => {
        const boom = (aura.data.bank ?? 0) * TOUCH_PCT
        if (boom <= 0) return
        s.damage('Touch of the Magi', boom, { canCrit: false, tags: ['arcane'] })
      },
    },
  ],

  abilities: [
    {
      id: 'arcane_blast',
      name: 'Arcane Blast',
      icon: 'spell_arcane_blast',
      spellId: 30451,
      castTime: 2.25,
      displayName: (s) => (s.auraRemains('player', 'prismatic_bolt') > 0 ? 'Prismatic Bolt' : 'Arcane Blast'),
      displayIcon: (s) => (s.auraRemains('player', 'prismatic_bolt') > 0 ? 'inv_enchant_prismaticsphere' : 'spell_arcane_blast'),
      onResolve: (s) => {
        if (s.auraRemains('player', 'prismatic_bolt') > 0) {
          // Apex: Prismatic Bolt replaces this Arcane Blast
          s.removeAura('player', 'prismatic_bolt')
          const cp = s.stacks('player', 'cumulative_power')
          if (cp > 0) s.removeAura('player', 'cumulative_power')
          arcaneDamage(s, 'prismatic_bolt', PRISMATIC_COEFF * (1 + CP_PER_STACK * cp))
          s.gain(4, 'prismatic_bolt')
          return
        }
        const charges = s.insanity
        arcaneDamage(s, 'arcane_blast', AB_COEFF * (1 + AB_PER_CHARGE * charges))
        s.gain(1, 'arcane_blast')
        // Splintering Sorcery: Arcane Blast conjures an Arcane Splinter
        conjureSplinters(s, 1)
        if (s.rng('clearcasting') < CC_CHANCE) {
          s.applyAura('player', 'clearcasting', { stacks: 1 })
          // Shifting Shards: gaining Clearcasting conjures 2 Splinters
          conjureSplinters(s, 2)
        }
      },
    },
    {
      id: 'arcane_barrage',
      name: 'Arcane Barrage',
      icon: 'ability_mage_arcanebarrage',
      spellId: 44425,
      onResolve: (s) => {
        const charges = s.insanity
        const salvo = s.stacks('player', 'arcane_salvo')
        let coeff = BARRAGE_COEFF * (1 + BARRAGE_PER_CHARGE * charges) * (1 + BARRAGE_PER_SALVO * salvo)
        // Polished Focus: Barrages at 20+ Salvo hit 15% harder and refund 3 stacks
        const polished = salvo >= 20
        if (polished) coeff *= POLISHED_FOCUS_MULT
        arcaneDamage(s, 'arcane_barrage', coeff)
        if (salvo > 0) {
          s.removeAura('player', 'arcane_salvo')
          if (polished) s.applyAura('player', 'arcane_salvo', { stacks: POLISHED_FOCUS_REFUND })
          // Apex: each Salvo stack consumed can proc Prismatic Bolt
          if (s.rng('prismatic') < salvo * PRISMATIC_PER_SALVO) s.applyAura('player', 'prismatic_bolt')
        }
        s.spend(4) // spends all charges
      },
    },
    {
      id: 'arcane_missiles',
      name: 'Arcane Missiles',
      icon: 'spell_nature_starfall',
      spellId: 5143,
      usable: (s) => (s.stacks('player', 'clearcasting') > 0 ? true : 'requires Clearcasting'),
      onCastStart: (s) => s.consumeStack('player', 'clearcasting'),
      channel: {
        duration: 2.4,
        ticks: 7, // S2 2pc: one additional wave
        hasted: true,
        onTick: (s) => {
          arcaneDamage(s, 'arcane_missiles', MISSILE_TICK)
          s.applyAura('player', 'arcane_salvo', { stacks: 1 })
          s.applyAura('player', 'cumulative_power', { stacks: 1 }) // S2 4pc
        },
      },
      onResolve: () => {},
    },
    {
      id: 'arcane_orb',
      name: 'Arcane Orb',
      icon: 'spell_mage_arcaneorb',
      spellId: 153626,
      cooldown: 20,
      onResolve: (s) => {
        arcaneDamage(s, 'arcane_orb', ORB_COEFF)
        s.gain(2, 'arcane_orb') // 1 on cast + 1 for the target hit
        // Splintering Orbs: the Orb conjures 2 Arcane Splinters
        conjureSplinters(s, 2)
      },
    },
    {
      id: 'touch_of_the_magi',
      name: 'Touch of the Magi',
      icon: 'spell_arcane_arcane02',
      spellId: 321507,
      cooldown: 45,
      onResolve: (s) => {
        arcaneDamage(s, 'touch_of_the_magi', TOUCH_HIT)
        s.applyAura('target', 'touch_of_the_magi')
        s.gain(4, 'touch_of_the_magi') // loads to 4 charges
      },
    },
    {
      id: 'arcane_surge',
      name: 'Arcane Surge',
      icon: 'ability_mage_arcanesurge',
      spellId: 365350,
      castTime: 2.5,
      cooldown: 90,
      onResolve: (s) => {
        arcaneDamage(s, 'arcane_surge', SURGE_COEFF)
        s.applyAura('player', 'arcane_surge')
        s.gain(4, 'arcane_surge')
        // Splinterstorm (12.0 redesign): Surge conjures a burst of 8 Splinters
        conjureSplinters(s, 8)
      },
    },
  ],

  actionBar: [
    'arcane_blast', 'arcane_barrage', 'arcane_missiles', 'arcane_orb',
    'touch_of_the_magi', 'arcane_surge',
  ],

  damageMult: (s) => (s.auraRemains('player', 'arcane_surge') > 0 ? SURGE_BUFF : 1),

  glows: (s, id) => {
    switch (id) {
      case 'arcane_missiles': return s.stacks('player', 'clearcasting') > 0
      case 'arcane_blast': return s.auraRemains('player', 'prismatic_bolt') > 0
      case 'arcane_barrage': return s.insanity === 4 && (s.stacks('player', 'arcane_salvo') >= 20
        || (s.stacks('player', 'clearcasting') > 0 && s.stacks('player', 'arcane_salvo') >= 12))
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'arcane_surge', text: 'On cooldown — Splinterstorm: conjures 8 Arcane Splinters, doubles conjuring for 15s', when: s => s.cooldownRemains('arcane_surge') === 0 },
    { abilityId: 'touch_of_the_magi', text: 'On cooldown, with Surge when possible (banks 20% of damage for 12s)', when: s => s.cooldownRemains('touch_of_the_magi') === 0 },
    { abilityId: 'arcane_blast', label: 'Prismatic Bolt', icon: 'inv_enchant_prismaticsphere', text: 'Fire without Clearcasting, or at 6+ Cumulative Power', when: s => s.auraRemains('player', 'prismatic_bolt') > 0 && (s.stacks('player', 'clearcasting') === 0 || s.stacks('player', 'cumulative_power') >= 6) },
    { abilityId: 'arcane_barrage', text: 'At 4 charges and 20 Arcane Salvo — Polished Focus: +15% and refunds 3 stacks', when: s => s.insanity === 4 && s.stacks('player', 'arcane_salvo') >= 20 },
    { abilityId: 'arcane_missiles', text: 'Clearcasting under 15 Salvo — builds Salvo + Cumulative Power', when: s => s.stacks('player', 'clearcasting') > 0 && s.stacks('player', 'arcane_salvo') < 15 },
    { abilityId: 'arcane_blast', label: 'Prismatic Bolt', icon: 'inv_enchant_prismaticsphere', text: 'Fire when it procs — your hardest hit', when: s => s.auraRemains('player', 'prismatic_bolt') > 0 },
    { abilityId: 'arcane_barrage', text: 'At 4 charges, 12+ Salvo while holding Clearcasting — fishes Prismatic Bolt', when: s => s.insanity === 4 && s.stacks('player', 'clearcasting') > 0 && s.stacks('player', 'arcane_salvo') >= 12 },
    { abilityId: 'arcane_orb', text: 'On cooldown at ≤1 Arcane Charge — conjures 2 Splinters', when: s => s.cooldownRemains('arcane_orb') === 0 && s.insanity <= 1 },
    { abilityId: 'arcane_blast', text: 'Filler — builds charges, Clearcasting, and Splinters' },
  ],

  policy: (s) => {
    // never clip an Arcane Missiles channel
    if (s.casting?.channel) return null
    const charges = s.insanity
    const cc = s.stacks('player', 'clearcasting')
    const salvo = s.stacks('player', 'arcane_salvo')
    const cp = s.stacks('player', 'cumulative_power')
    const prismatic = s.auraRemains('player', 'prismatic_bolt') > 0

    if (s.cooldownRemains('arcane_surge') === 0) return 'arcane_surge'
    if (s.cooldownRemains('touch_of_the_magi') === 0) return 'touch_of_the_magi'
    if (prismatic && (cc === 0 || cp >= 6)) return 'arcane_blast'
    if (charges === 4 && salvo >= 20) return 'arcane_barrage'
    if (cc > 0 && salvo < 15) return 'arcane_missiles'
    if (prismatic) return 'arcane_blast'
    if (charges === 4 && cc > 0 && salvo >= 12) return 'arcane_barrage'
    if (s.cooldownRemains('arcane_orb') === 0 && charges <= 1) return 'arcane_orb'
    return 'arcane_blast'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['arcane_blast', 'arcane_missiles']
    const chargeLoaders = ['arcane_orb', 'arcane_blast']
    const burst = ['arcane_surge', 'touch_of_the_magi']
    const sets = [fillers, chargeLoaders, burst]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
