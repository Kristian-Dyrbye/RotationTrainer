import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Arcane Mage — patch 12.1.0 (Midnight, Season 2), Sunfury raid ST build.
 * Modeled from the Wowhead/Icy Veins/Method 12.1 guides (verified 2026-08-24):
 * - https://www.wowhead.com/guide/classes/mage/arcane/rotation-cooldowns-pve-dps
 * - https://www.icy-veins.com/wow/arcane-mage-pve-dps-rotation-cooldowns-abilities
 * - https://www.method.gg/guides/arcane-mage/playstyle-and-rotation
 *
 * Resource model: Arcane Charges (max 4) as the primary bar. Mana is never
 * constraining on a dummy and is not modeled (Evocation/Presence of Mind cut).
 * 12.1 loop: Arcane Missiles waves build Arcane Salvo (cap 25 with Sunfury);
 * Arcane Barrage at 4 charges dumps at 25 Salvo — or at 12+ while holding a
 * Clearcasting proc — and rolls ~2%/stack to proc the Apex ability Prismatic
 * Bolt (replaces the next Arcane Blast, loads 4 charges). Arcane Missiles
 * only under 12 Salvo. Arcane Surge grants Arcane Soul when it ends (Barrage
 * spam that refunds Clearcasting) and summons the Arcane Phoenix.
 * Source note: Wowhead's rotation text still says "dump at 20 / Missiles
 * under 15" — those are the Spellslinger numbers; Method + Icy Veins agree
 * on 25 / 12+CC / under-12 for Sunfury, which is what is modeled here.
 * S2 tier: 2pc Arcane Missiles fires a 7th wave and +5% damage (folded into
 * the wave count/coefficient); 4pc each Missiles wave grants Cumulative
 * Power (+3% to the next Prismatic Bolt / Arcane Blast, cap 8 stacks) —
 * Method holds Prismatic Bolt for the full 8 stacks.
 * APPROX-flagged: Clearcasting rate, Prismatic proc chance per Salvo stack,
 * Arcane Soul window, Phoenix cadence, Spellfire Sphere haste/damage riders
 * (folded into coefficients). Damage in SP units.
 */

const AB_COEFF = 0.95
const AB_PER_CHARGE = 0.55
const BARRAGE_COEFF = 0.65
const BARRAGE_PER_CHARGE = 0.40
const BARRAGE_PER_SALVO = 0.04    // APPROX: Salvo "significantly" buffs Barrage
const SOUL_BARRAGE_MULT = 1.5     // APPROX: Arcane Soul empowered Barrages
const MISSILE_TICK = 0.36         // 7 waves (S2 2pc), incl. 2pc +5%
const ORB_COEFF = 1.30
const PRISMATIC_COEFF = 3.2       // APPROX: "by far your highest damaging ability"
const PRISMATIC_PER_SALVO = 0.02  // per Wowhead: 40% at 20 Salvo, 50% at 25
const CP_PER_STACK = 0.03         // S2 4pc: Cumulative Power
const PHOENIX_HIT = 0.60          // APPROX: Arcane Phoenix bolt (Sunfury)
const TOUCH_HIT = 0.50
const TOUCH_PCT = 0.20
const SURGE_COEFF = 5.8
const SURGE_BUFF = 1.35           // 12.1: +35% spell damage for 15s
const CC_CHANCE = 0.25            // APPROX: Clearcasting per Arcane Blast

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

export const arcaneMage: SpecConfig = {
  name: 'Arcane Mage',
  specId: 'mage-arcane',
  specIcon: 'spell_holy_magicalsentry',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/mage/arcane/rotation-cooldowns-pve-dps',
    buildName: 'Arcane Raid — Sunfury (Icy Veins 12.1 default)',
    heroTalent: 'Sunfury',
    // Icy Veins "Arcane Raid - Sunfury" loadout, 12.1
    talentString: 'C4DAAAAAAAAAAAAAAAAAAAAAAYGGLzMzswMDamZGAAAGAwMz0sssMDAgNAAAzMDbWmxMLzYMzMzMsxMmZmBAYAAAGgZGwMAYYmZA',
    retrieved: '2026-08-24',
  },
  resourceName: 'Arcane Charges',
  resourceMax: 4,
  startingResource: 0,

  auras: [
    { id: 'clearcasting', name: 'Clearcasting', icon: 'spell_shadow_manaburn', duration: 20, maxStacks: 3 },
    { id: 'arcane_salvo', name: 'Arcane Salvo', icon: 'spell_arcane_arcane01', duration: 40, maxStacks: 25 },
    { id: 'cumulative_power', name: 'Cumulative Power', icon: 'spell_arcane_arcanepotency', duration: 30, maxStacks: 8 },
    { id: 'prismatic_bolt', name: 'Prismatic Bolt', icon: 'inv_enchant_prismaticsphere', duration: 30 },
    {
      id: 'arcane_surge', name: 'Arcane Surge', icon: 'ability_mage_arcanesurge', duration: 15,
      // Sunfury: when Surge ends, Arcane Soul opens a Barrage-spam window
      onExpire: (s) => s.applyAura('player', 'arcane_soul'),
    },
    { id: 'arcane_soul', name: 'Arcane Soul', icon: 'spell_arcane_arcane03', duration: 4 },
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
        if (s.rng('clearcasting') < CC_CHANCE) s.applyAura('player', 'clearcasting', { stacks: 1 })
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
        const soul = s.auraRemains('player', 'arcane_soul') > 0
        let coeff = BARRAGE_COEFF * (1 + BARRAGE_PER_CHARGE * charges) * (1 + BARRAGE_PER_SALVO * salvo)
        if (soul) coeff *= SOUL_BARRAGE_MULT
        arcaneDamage(s, 'arcane_barrage', coeff)
        if (salvo > 0) {
          s.removeAura('player', 'arcane_salvo')
          // Apex: each Salvo stack consumed can proc Prismatic Bolt
          if (s.rng('prismatic') < salvo * PRISMATIC_PER_SALVO) s.applyAura('player', 'prismatic_bolt')
        }
        if (soul) {
          // Arcane Soul: Barrages are free and refund Clearcasting
          s.applyAura('player', 'clearcasting', { stacks: 1 })
        } else {
          s.spend(4) // spends all charges
        }
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
        // Sunfury: the Arcane Phoenix fights alongside you through the burst
        for (let i = 1; i <= 6; i++) {
          s.schedule(s.time + 2 * i, () => {
            if (s.auraRemains('player', 'arcane_surge') > 0) {
              arcaneDamage(s, 'Arcane Phoenix', PHOENIX_HIT, { canCrit: false })
            }
          })
        }
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
      case 'arcane_barrage': return s.auraRemains('player', 'arcane_soul') > 0
        || (s.insanity === 4 && (s.stacks('player', 'arcane_salvo') >= 25
          || (s.stacks('player', 'clearcasting') > 0 && s.stacks('player', 'arcane_salvo') >= 12)))
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'arcane_surge', text: 'On cooldown — Phoenix joins in, Arcane Soul follows', when: s => s.cooldownRemains('arcane_surge') === 0 },
    { abilityId: 'touch_of_the_magi', text: 'On cooldown, with Surge when possible (banks 20% of damage for 12s)', when: s => s.cooldownRemains('touch_of_the_magi') === 0 },
    { abilityId: 'arcane_barrage', text: 'Spam during Arcane Soul (free, refunds Clearcasting)', when: s => s.auraRemains('player', 'arcane_soul') > 0 },
    { abilityId: 'arcane_missiles', text: 'Clearcasting under 12 Salvo — builds Salvo + Cumulative Power', when: s => s.stacks('player', 'clearcasting') > 0 && s.stacks('player', 'arcane_salvo') < 12 },
    { abilityId: 'arcane_blast', label: 'Prismatic Bolt', icon: 'inv_enchant_prismaticsphere', text: 'Fire at 8 Cumulative Power (the 4pc cap)', when: s => s.auraRemains('player', 'prismatic_bolt') > 0 && s.stacks('player', 'cumulative_power') >= 8 },
    { abilityId: 'arcane_barrage', text: 'At 4 charges: 25 Salvo, or 12+ while holding Clearcasting — fishes Prismatic Bolt', when: s => s.insanity === 4 && (s.stacks('player', 'arcane_salvo') >= 25 || (s.stacks('player', 'clearcasting') > 0 && s.stacks('player', 'arcane_salvo') >= 12)) },
    { abilityId: 'arcane_blast', label: 'Prismatic Bolt', icon: 'inv_enchant_prismaticsphere', text: 'Fire when it procs — your hardest hit', when: s => s.auraRemains('player', 'prismatic_bolt') > 0 },
    { abilityId: 'arcane_orb', text: 'On cooldown at ≤1 Arcane Charge', when: s => s.cooldownRemains('arcane_orb') === 0 && s.insanity <= 1 },
    { abilityId: 'arcane_blast', text: 'Filler — builds charges and Clearcasting' },
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
    if (s.auraRemains('player', 'arcane_soul') > 0) return 'arcane_barrage'
    if (cc > 0 && salvo < 12) return 'arcane_missiles'
    if (prismatic && cp >= 8) return 'arcane_blast'
    if (charges === 4 && (salvo >= 25 || (cc > 0 && salvo >= 12))) return 'arcane_barrage'
    if (prismatic) return 'arcane_blast'
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
