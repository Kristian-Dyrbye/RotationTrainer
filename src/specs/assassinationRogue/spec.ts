import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Assassination Rogue — patch 12.1.0 (Midnight, Season 2), Deathstalker
 * "Pure Single-Target" raid build. Verified 2026-08-24 against:
 * - Wowhead rotation guide: https://www.wowhead.com/guide/classes/rogue/assassination/rotation-cooldowns-pve-dps
 * - Icy Veins rotation: https://www.icy-veins.com/wow/assassination-rogue-pve-dps-rotation-cooldowns-abilities
 *   (talent string from https://www.icy-veins.com/wow/assassination-rogue-pve-dps-spec-builds-talents)
 * - Method: https://www.method.gg/guides/assassination-rogue/playstyle-and-rotation
 *
 * Live 12.1 priority modeled: keep Garrote (applies Deathstalker's Mark) and
 * Rupture (refresh with 5+ CP) rolling; Deathmark on cooldown with bleeds up;
 * Kingsbane on cooldown, synced into Deathmark; Envenom at 5+ CP — at 7 CP
 * when Darkest Night is active (consumes it for a big hit and 3 fresh Marks);
 * Ambush on Blindside procs, Mutilate as filler.
 *
 * Resource model: Energy 100, 10/s base regen (hasted); Combo Points as a
 * 7-stack player aura. Venomous Wounds folded into Rupture ticks (+4 energy).
 * S2 tier: 2pc Envenom +10% (folded into coefficient) and the Envenom buff
 * grants +3% damage dealt; 4pc Deadly Poison makes bleeds +10% on the target.
 * APPROX list: poison/Blindside proc rates, Kingsbane ramp, auto cadence,
 * Seal Fate as crit-chance extra CP, Deathmark "doubles poisons and bleeds"
 * modeled as a flat 1.5x on bleed/poison damage plus 40 energy on cast,
 * Vanish/Improved Garrote and Shiv-with-Darkest-Night unmodeled (dummy
 * scope). Damage in AP units.
 */

const AUTO_COEFF = 0.24        // APPROX: DW combined stream
const MUT_COEFF = 1.15         // both daggers
const AMBUSH_COEFF = 1.30
const GARROTE_TICK = 0.30
const RUPTURE_TICK = 0.50
const DP_TICK = 0.34
const ENV_PER_CP = 0.58        // incl. S2 2pc +10%
const KB_HIT = 1.50
const KB_TICK = 0.55           // 7 pulses, ramping (APPROX)
const MARK_HIT = 0.90          // Deathstalker's Mark plasma bolt
const DARKEST_NIGHT_MULT = 1.6
const ENVENOM_POISON_MULT = 1.3
const DP_PROC = 0.30           // APPROX: per auto swing
const BLINDSIDE_PROC = 0.20    // APPROX: per Mutilate

function addCP(s: SimAPI, n: number) {
  s.applyAura('player', 'combo_points', { stacks: n })
}

/** read-and-clear combo points for a finisher */
function spendCP(s: SimAPI): number {
  const cp = s.stacks('player', 'combo_points')
  s.removeAura('player', 'combo_points')
  return cp
}

function applyDeadlyPoison(s: SimAPI) {
  s.applyAura('target', 'deadly_poison')
}

export const assassinationRogue: SpecConfig = {
  name: 'Assassination Rogue',
  specId: 'rogue-assassination',
  specIcon: 'ability_rogue_deadlybrew',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/rogue/assassination/rotation-cooldowns-pve-dps',
    buildName: 'Pure Single-Target (Raid)',
    heroTalent: 'Deathstalker',
    // Icy Veins "Assassination Pure Single-Target - Deathstalker", 12.1
    talentString: 'CMQAAAAAAAAAAAAAAAAAAAAAAYmlxsNDGAAAAAY2GsNDAAAAAIbzMzMzMjxyMzMbzsMzMzYGzYMmZMMAbmlBGwCYZYCMsYwMDwYMA',
    retrieved: '2026-08-24',
  },
  resourceName: 'Energy',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    // energy regen: 10/s base, scales with haste
    const regen = () => {
      s.gain(5 / s.hasteMult(), 'energy_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
    // dual-wield autos: combined stream; swings can refresh Deadly Poison
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      if (s.rng('dp_proc') < DP_PROC && s.auraRemains('target', 'deadly_poison') > 0) {
        applyDeadlyPoison(s)
      }
      s.schedule(s.time + 1.3 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'combo_points', name: 'Combo Points', icon: 'ability_rogue_eviscerate', duration: Infinity, maxStacks: 7 },
    {
      id: 'garrote', name: 'Garrote', icon: 'ability_rogue_garrote', duration: 18, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('garrote', GARROTE_TICK, { tags: ['bleed'] }) },
    },
    {
      id: 'rupture', name: 'Rupture', icon: 'ability_rogue_rupture', duration: 24, pandemic: true, debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          s.damage('rupture', RUPTURE_TICK, { tags: ['bleed'] })
          s.gain(4, 'venomous_wounds') // Venomous Wounds folded
        },
      },
    },
    {
      id: 'deadly_poison', name: 'Deadly Poison', icon: 'ability_rogue_dualweild', duration: 12, pandemic: true, debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          const envenomed = s.auraRemains('player', 'envenom') > 0
          s.damage('deadly_poison', DP_TICK * (envenomed ? ENVENOM_POISON_MULT : 1), { tags: ['poison'] })
        },
      },
    },
    { id: 'envenom', name: 'Envenom', icon: 'ability_rogue_disembowel', duration: 6 },
    { id: 'blindside', name: 'Blindside', icon: 'ability_rogue_focusedattacks', duration: 10 },
    { id: 'darkest_night', name: 'Darkest Night', icon: 'spell_shadow_nightofthedead', duration: 30 },
    { id: 'deathmark', name: 'Deathmark', icon: 'ability_rogue_deathmark', duration: 16, debuff: true },
    { id: 'deathstalkers_mark', name: "Deathstalker's Mark", icon: 'inv_ability_deathstalkerrogue_deathstalkersmark', duration: 60, maxStacks: 3, debuff: true },
  ],

  abilities: [
    {
      id: 'mutilate',
      name: 'Mutilate',
      icon: 'ability_rogue_shadowstrikes',
      spellId: 1329,
      cost: 50,
      onResolve: (s) => {
        s.damage('mutilate', MUT_COEFF)
        applyDeadlyPoison(s)
        // Seal Fate folded: crits award a bonus point (APPROX)
        addCP(s, s.rng('seal_fate') < s.stats.critChance ? 3 : 2)
        if (s.rng('blindside') < BLINDSIDE_PROC) s.applyAura('player', 'blindside')
      },
    },
    {
      id: 'ambush',
      name: 'Ambush',
      icon: 'ability_ambush',
      spellId: 8676,
      cost: 50,
      costMod: (s) => (s.auraRemains('player', 'blindside') > 0 ? 25 : 50),
      usable: (s) => (s.auraRemains('player', 'blindside') > 0 ? true : 'requires Blindside proc'),
      onResolve: (s) => {
        s.removeAura('player', 'blindside')
        s.damage('ambush', AMBUSH_COEFF)
        applyDeadlyPoison(s)
        addCP(s, s.rng('seal_fate_ambush') < s.stats.critChance ? 3 : 2)
      },
    },
    {
      id: 'garrote',
      name: 'Garrote',
      icon: 'ability_rogue_garrote',
      spellId: 703,
      cost: 45,
      onResolve: (s) => {
        s.applyAura('target', 'garrote')
        // Deathstalker: Garrote loads Deathstalker's Mark (simplified: only
        // when no stacks remain — Envenom cycles them off)
        if (s.stacks('target', 'deathstalkers_mark') === 0) {
          s.applyAura('target', 'deathstalkers_mark', { stacks: 3 })
        }
        addCP(s, 1)
      },
    },
    {
      id: 'rupture',
      name: 'Rupture',
      icon: 'ability_rogue_rupture',
      spellId: 1943,
      cost: 25,
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const cp = spendCP(s)
        s.applyAura('target', 'rupture', { duration: 4 + 4 * cp })
      },
    },
    {
      id: 'envenom',
      name: 'Envenom',
      icon: 'ability_rogue_disembowel',
      spellId: 32645,
      cost: 35,
      usable: (s) => (s.stacks('player', 'combo_points') > 0 ? true : 'requires combo points'),
      onResolve: (s) => {
        const dn = s.auraRemains('player', 'darkest_night') > 0
        const cp = spendCP(s)
        const bigFinish = dn && cp >= 7
        let mult = 1
        if (bigFinish) {
          // Darkest Night: 7-CP Envenom consumes it — huge hit + 3 fresh Marks
          s.removeAura('player', 'darkest_night')
          mult = DARKEST_NIGHT_MULT
          s.applyAura('target', 'deathstalkers_mark', { stacks: 3 })
        }
        s.damage('envenom', ENV_PER_CP * cp * mult, { tags: ['poison'] })
        s.applyAura('player', 'envenom', { duration: 1 + cp })
        // Deathstalker's Mark: consume a stack for a plasma hit; the last
        // stack grants Darkest Night
        if (!bigFinish && s.stacks('target', 'deathstalkers_mark') > 0) {
          const last = s.stacks('target', 'deathstalkers_mark') === 1
          s.consumeStack('target', 'deathstalkers_mark')
          s.damage("Deathstalker's Mark", MARK_HIT)
          if (last) s.applyAura('player', 'darkest_night')
        }
      },
    },
    {
      id: 'kingsbane',
      name: 'Kingsbane',
      icon: 'inv_knife_1h_artifactgarona_d_01',
      spellId: 385627,
      cost: 35,
      cooldown: 60,
      onResolve: (s) => {
        s.damage('Kingsbane', KB_HIT, { tags: ['poison'] })
        addCP(s, 1)
        // ramping poison modeled as scheduled pulses (not a tracked debuff)
        for (let i = 1; i <= 7; i++) {
          s.schedule(s.time + i * 2, () => s.damage('Kingsbane', KB_TICK * (1 + 0.1 * i), { tags: ['poison'] }))
        }
      },
    },
    {
      id: 'deathmark',
      name: 'Deathmark',
      icon: 'ability_rogue_deathmark',
      spellId: 360194,
      cooldown: 120,
      onResolve: (s) => {
        s.applyAura('target', 'deathmark')
        s.gain(40, 'deathmark') // "grants energy" (APPROX)
      },
    },
  ],

  actionBar: [
    'mutilate', 'ambush', 'garrote', 'rupture', 'envenom', 'kingsbane', 'deathmark',
  ],

  // Deathmark "doubles" poisons and bleeds (APPROX flat 1.5x); S2 2pc:
  // Envenom buff grants +3% damage dealt; S2 4pc: Deadly Poison => bleeds +10%
  damageMult: (s, _id, tags) => {
    let m = 1
    if (s.auraRemains('player', 'envenom') > 0) m *= 1.03
    const affected = tags.includes('bleed') || tags.includes('poison')
    if (affected && s.auraRemains('target', 'deathmark') > 0) m *= 1.5
    if (tags.includes('bleed') && s.auraRemains('target', 'deadly_poison') > 0) m *= 1.10
    return m
  },

  glows: (s, id) => {
    const dn = s.auraRemains('player', 'darkest_night') > 0
    switch (id) {
      case 'envenom': return s.stacks('player', 'combo_points') >= (dn ? 7 : 5)
      case 'rupture': return s.stacks('player', 'combo_points') >= 5 && s.auraRemains('target', 'rupture') < 7.2
      case 'garrote': return s.auraRemains('target', 'garrote') < 5.4
      case 'ambush': return s.auraRemains('player', 'blindside') > 0
      case 'kingsbane': return s.cooldownRemains('kingsbane') === 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'garrote', text: 'Keep it rolling — applies Deathstalker’s Mark; refresh in pandemic (<5.4s)', when: s => s.auraRemains('target', 'garrote') < 5.4 },
    { abilityId: 'rupture', text: 'Maintain with 5+ CP — refresh in pandemic (<7.2s), Venomous Wounds energy', when: s => s.stacks('player', 'combo_points') >= 5 && s.auraRemains('target', 'rupture') < 7.2 },
    { abilityId: 'deathmark', text: 'On cooldown with both bleeds up — doubles your poisons and bleeds', when: s => s.cooldownRemains('deathmark') === 0 },
    { abilityId: 'kingsbane', text: 'On cooldown, synced into Deathmark every 2 minutes', when: s => s.cooldownRemains('kingsbane') === 0 },
    { abilityId: 'envenom', text: 'At 5+ CP — at 7 CP when Darkest Night is active (big hit + 3 Marks)', when: s => s.stacks('player', 'combo_points') >= (s.auraRemains('player', 'darkest_night') > 0 ? 7 : 5) },
    { abilityId: 'ambush', text: 'On Blindside procs — cheap 2-CP builder', when: s => s.auraRemains('player', 'blindside') > 0 },
    { abilityId: 'mutilate', text: 'Builder — pool toward 50 energy, never sit at the cap' },
  ],

  policy: (s) => {
    const cp = s.stacks('player', 'combo_points')
    const garroteR = s.auraRemains('target', 'garrote')
    const ruptureR = s.auraRemains('target', 'rupture')
    const bleedsUp = garroteR > 0 && ruptureR > 0
    const dmUp = s.auraRemains('target', 'deathmark') > 0
    const dn = s.auraRemains('player', 'darkest_night') > 0

    if (garroteR <= 0) return 'garrote'
    if (cp >= 1 && ruptureR <= 0) return 'rupture'
    if (garroteR < 5.4) return 'garrote'
    if (cp >= 5 && ruptureR < 7.2) return 'rupture'
    if (bleedsUp && s.cooldownRemains('deathmark') === 0) return 'deathmark'
    if (bleedsUp && s.cooldownRemains('kingsbane') === 0
      && (dmUp || s.cooldownRemains('deathmark') > 30)) return 'kingsbane'
    if (cp >= (dn ? 7 : 5)) return 'envenom'
    if (s.auraRemains('player', 'blindside') > 0) return 'ambush'
    return 'mutilate'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const finishers = ['envenom', 'rupture']
    const builders = ['mutilate', 'ambush', 'garrote']
    const sets = [finishers, builders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
