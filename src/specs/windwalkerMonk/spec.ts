import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Windwalker Monk — patch 12.1.0 (Midnight, Season 2), Shado-Pan raid
 * single-target build (the consensus raid pick: ~100% heroic / ~91% mythic
 * usage on Archon; Icy Veins recommends it "on all boss fights this tier").
 * Verified against live guides 2026-08-24:
 *   - Wowhead rotation guide: https://www.wowhead.com/guide/classes/monk/windwalker/rotation-cooldowns-pve-dps
 *   - Icy Veins rotation: https://www.icy-veins.com/wow/windwalker-monk-pve-dps-rotation-cooldowns-abilities
 *   - Icy Veins builds (talent string source): https://www.icy-veins.com/wow/windwalker-monk-pve-dps-spec-builds-talents
 *   - Method playstyle/rotation: https://www.method.gg/guides/windwalker-monk/playstyle-and-rotation
 *
 * Resource model: Energy (max 100) with a hasted regen loop; Chi is an aura
 * stack pool (max 5). Mastery: Combo Strikes — every ability that differs
 * from the previous one hits 15% harder (fixed mastery stand-in), and the
 * oracle never repeats an ability (Hit Combo assumed).
 *
 * Midnight kit changes modeled: Zenith (2 charges) replaces SEF as the
 * damage window — activating it stomps (Zenith Stomp damage + 2 Chi),
 * resets Rising Sun Kick, cuts all Chi-spender costs by 1 (Blackout Kick
 * free) and doubles Blackout Kick's cooldown reduction; Zenith Stomp is
 * recastable during the window for 2 Chi. Rushing Wind Kick: Blackout Kick
 * has a chance to turn the next Rising Sun Kick into a free, harder-hitting
 * Rushing Wind Kick. Apex: Tigereye Brew — 1 stack per 3 Chi spent,
 * consumed by Zenith for +1% crit per stack (modeled as a flat damage
 * multiplier during the window). Shado-Pan hero: autos build Flurry
 * Charges, Zenith grants 10, Fists of Fury unleashes them all as Flurry
 * Strikes; RSK/SCK launch 3 during Zenith; every 10th Flurry Strike
 * triggers a Wisdom of the Wall burst (simplified).
 * S2 tier: 2pc — Fists of Fury strikes an extra time at channel start at
 * 50% effectiveness; 4pc "Unbroken Rhythm" — each Fists of Fury strike
 * buffs your next Rising Sun Kick +10% (or Spinning Crane Kick +20%),
 * stacking to 6. On one target the guides consume it with Rising Sun Kick.
 *
 * APPROX-flagged: all damage coefficients (AP units, relative magnitudes
 * only), auto cadence, energy regen curve, Zenith duration (15s) and
 * recharge (90s), Blackout Kick!/Rushing Wind Kick/Dance of Chi-Ji proc
 * rates, Flurry Charge generation, Whirling Dragon Punch "grace period"
 * (modeled as its plain RSK+FoF-on-cooldown requirement), Xuen as 10
 * scheduled pulses, Touch of Death as a flat hit on a 90s cooldown.
 */

const AUTO_COEFF = 0.22
const TP_COEFF = 0.55
const BOK_COEFF = 0.8
const RSK_COEFF = 1.75
const RWK_MULT = 1.3           // Rushing Wind Kick premium over RSK (APPROX)
const FOF_TICK = 1.0           // 5 ticks
const FOF_2PC = 0.5            // S2 2pc: extra strike at 50% effectiveness
const WDP_PULSE = 0.65         // 3 pulses
const SOTW_COEFF = 2.6
const SCK_COEFF = 1.25
const STOMP_COEFF = 1.5        // Zenith Stomp (activation and recast)
const TOD_COEFF = 6.0          // APPROX: 35% max-HP hit as a flat coefficient
const SLICE_COEFF = 1.8
const XUEN_PULSE = 0.38        // 10 pulses over 20s
const FLURRY_COEFF = 0.18      // per Flurry Strike
const WISDOM_COEFF = 1.0       // Wisdom of the Wall burst
const COMBO_MULT = 1.15
const ZENITH_DURATION = 15     // APPROX: window length unpublished
const BOK_PROC_CHANCE = 0.15   // APPROX: Blackout Kick! per Tiger Palm
const RWK_PROC_CHANCE = 0.4    // per Blackout Kick (wow.gg tooltip mining)
const DANCE_PROC_CHANCE = 0.2  // APPROX: Dance of Chi-Ji per Chi spender
const FLURRY_AUTO_CHANCE = 0.3 // APPROX: Flurry Charge per auto

const STRIKE_IDX: Record<string, number> = {
  tiger_palm: 1,
  rising_sun_kick: 2,
  blackout_kick: 3,
  fists_of_fury: 4,
  whirling_dragon_punch: 5,
  strike_of_the_windlord: 6,
  spinning_crane_kick: 7,
  zenith_stomp: 8,
  slicing_winds: 9,
  touch_of_death: 10,
  zenith: 11,
  invoke_xuen: 12,
}

function chi(s: SimAPI): number {
  return s.stacks('player', 'chi')
}

function gainChi(s: SimAPI, n: number) {
  s.applyAura('player', 'chi', { stacks: n })
}

/** spend Chi + feed the Tigereye Brew accumulator (1 stack per 3 Chi) */
function spendChi(s: SimAPI, n: number) {
  for (let i = 0; i < n; i++) s.consumeStack('player', 'chi')
  s.data.chi_spent = (s.data.chi_spent ?? 0) + n
  while (s.data.chi_spent >= 3) {
    s.data.chi_spent -= 3
    s.data.tigereye = Math.min(20, (s.data.tigereye ?? 0) + 1)
  }
}

function zenithActive(s: SimAPI): boolean {
  return s.auraRemains('player', 'zenith') > 0
}

/** Mastery: Combo Strikes — differs from the last strike → 15% more */
function comboMult(s: SimAPI, id: string): number {
  const idx = STRIKE_IDX[id]
  const mult = s.data.last_strike === idx ? 1 : COMBO_MULT
  s.data.last_strike = idx
  return mult
}

/** Shado-Pan: bank Flurry Charges (cap 30) */
function gainFlurry(s: SimAPI, n: number) {
  s.data.flurry = Math.min(30, (s.data.flurry ?? 0) + n)
}

/** unleash n Flurry Strikes; every 10th triggers Wisdom of the Wall */
function flurryStrikes(s: SimAPI, n: number) {
  for (let i = 0; i < n; i++) {
    s.damage('Flurry Strikes', FLURRY_COEFF)
    s.data.flurry_count = (s.data.flurry_count ?? 0) + 1
    if (s.data.flurry_count >= 10) {
      s.data.flurry_count -= 10
      s.damage('Wisdom of the Wall', WISDOM_COEFF)
    }
  }
}

/** Dance of Chi-Ji: chance on Chi-spender casts, banks to 2 */
function rollDance(s: SimAPI) {
  if (s.rng('dance_proc') < DANCE_PROC_CHANCE) s.applyAura('player', 'dance_proc', { stacks: 1 })
}

export const windwalkerMonk: SpecConfig = {
  name: 'Windwalker Monk',
  specId: 'monk-windwalker',
  specIcon: 'spell_monk_windwalker_spec',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/monk/windwalker/rotation-cooldowns-pve-dps',
    buildName: 'Windwalker Raids — Shado-Pan (Icy Veins quick-start raid build)',
    heroTalent: 'Shado-Pan',
    // published verbatim as "Windwalker Raids - Shado-Pan" on
    // icy-veins.com/wow/windwalker-monk-pve-dps-spec-builds-talents (2026-08-11)
    talentString: 'C0QAAAAAAAAAAAAAAAAAAAAAAMzYM2GmhlZGbzAAAAAAAAAAAAsMMCzwwAmZGmZmZY2GmhZZmAAWMz2MjZmZmBAwGAMLzSzMzsAgBmZAYsMAGwFA',
    retrieved: '2026-08-24',
  },
  resourceName: 'Energy',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    const regen = () => {
      s.gain(5 / s.hasteMult(), 'energy_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      if (s.rng('flurry_auto') < FLURRY_AUTO_CHANCE) gainFlurry(s, 1)
      s.schedule(s.time + 1.4 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.2, swing)
  },

  // Tigereye Brew payout: flat damage multiplier while Zenith is up
  damageMult: (s) => (zenithActive(s) ? s.data.zenith_mult ?? 1 : 1),

  auras: [
    { id: 'chi', name: 'Chi', icon: 'ability_monk_healthsphere', duration: Infinity, maxStacks: 5 },
    { id: 'zenith', name: 'Zenith', icon: 'ability_monk_serenity', duration: ZENITH_DURATION },
    { id: 'bok_proc', name: 'Blackout Kick!', icon: 'ability_monk_roundhousekick', duration: 15, maxStacks: 2 },
    { id: 'rwk_proc', name: 'Rushing Wind Kick', icon: 'ability_monk_rushingjadewind', duration: 15 },
    { id: 'dance_proc', name: 'Dance of Chi-Ji', icon: 'monk_stance_redcrane', duration: 20, maxStacks: 2 },
    { id: 'unbroken_rhythm', name: 'Unbroken Rhythm', icon: 'monk_ability_fistoffury', duration: 30, maxStacks: 6 },
  ],

  abilities: [
    {
      id: 'tiger_palm',
      name: 'Tiger Palm',
      icon: 'ability_monk_tigerpalm',
      spellId: 100780,
      cost: 50,
      onResolve: (s) => {
        s.damage('tiger_palm', TP_COEFF * comboMult(s, 'tiger_palm'))
        gainChi(s, 2)
        if (s.rng('bok_proc') < BOK_PROC_CHANCE) s.applyAura('player', 'bok_proc', { stacks: 1 })
      },
    },
    {
      id: 'blackout_kick',
      name: 'Blackout Kick',
      icon: 'ability_monk_roundhousekick',
      spellId: 100784,
      displayStacks: (s) => s.stacks('player', 'bok_proc'),
      usable: (s) =>
        (s.stacks('player', 'bok_proc') > 0 || zenithActive(s) || chi(s) >= 1
          ? true
          : 'requires 1 Chi'),
      onResolve: (s) => {
        // free from a Blackout Kick! proc or during Zenith (cost reduced to 0)
        if (s.stacks('player', 'bok_proc') > 0) s.consumeStack('player', 'bok_proc')
        else if (!zenithActive(s)) spendChi(s, 1)
        s.damage('blackout_kick', BOK_COEFF * comboMult(s, 'blackout_kick'))
        const cdr = zenithActive(s) ? 2 : 1 // Zenith: +1s cooldown reduction
        s.reduceCooldown('rising_sun_kick', cdr)
        s.reduceCooldown('fists_of_fury', cdr)
        if (s.rng('rwk_proc') < RWK_PROC_CHANCE) s.applyAura('player', 'rwk_proc')
      },
    },
    {
      id: 'rising_sun_kick',
      name: 'Rising Sun Kick',
      icon: 'ability_monk_risingsunkick',
      spellId: 107428,
      cooldown: 10,
      displayName: (s) => (s.auraRemains('player', 'rwk_proc') > 0 ? 'Rushing Wind Kick' : 'Rising Sun Kick'),
      displayIcon: (s) => (s.auraRemains('player', 'rwk_proc') > 0 ? 'ability_monk_rushingjadewind' : 'ability_monk_risingsunkick'),
      usable: (s) => {
        if (s.auraRemains('player', 'rwk_proc') > 0) return true // Rushing Wind Kick is free
        return chi(s) >= (zenithActive(s) ? 1 : 2) ? true : 'requires 2 Chi'
      },
      onResolve: (s) => {
        const rushing = s.auraRemains('player', 'rwk_proc') > 0
        if (rushing) s.removeAura('player', 'rwk_proc')
        else spendChi(s, zenithActive(s) ? 1 : 2)
        // S2 4pc: Unbroken Rhythm consumed by RSK on one target (+10%/stack)
        const ur = 1 + 0.1 * s.stacks('player', 'unbroken_rhythm')
        if (s.stacks('player', 'unbroken_rhythm') > 0) s.removeAura('player', 'unbroken_rhythm')
        const mult = comboMult(s, 'rising_sun_kick') * ur
        if (rushing) s.damage('rushing_wind_kick', RSK_COEFF * RWK_MULT * mult)
        else s.damage('rising_sun_kick', RSK_COEFF * mult)
        if (zenithActive(s)) flurryStrikes(s, 3) // Wisdom of the Wall (Shado-Pan)
        rollDance(s)
      },
    },
    {
      id: 'fists_of_fury',
      name: 'Fists of Fury',
      icon: 'monk_ability_fistoffury',
      spellId: 113656,
      cooldown: 24,
      usable: (s) => (chi(s) >= (zenithActive(s) ? 2 : 3) ? true : 'requires 3 Chi'),
      onCastStart: (s) => {
        spendChi(s, zenithActive(s) ? 2 : 3)
        s.data.fof_mult = comboMult(s, 'fists_of_fury')
        // S2 2pc: an additional strike at the start of the channel, 50% effectiveness
        s.damage('fists_of_fury', FOF_TICK * FOF_2PC * (s.data.fof_mult ?? 1))
        flurryStrikes(s, s.data.flurry ?? 0) // Shado-Pan: unleash banked Flurry Charges
        s.data.flurry = 0
        rollDance(s)
      },
      channel: {
        duration: 4,
        ticks: 5,
        hasted: true,
        onTick: (s) => {
          s.damage('fists_of_fury', FOF_TICK * (s.data.fof_mult ?? 1))
          s.applyAura('player', 'unbroken_rhythm', { stacks: 1 }) // S2 4pc
        },
      },
      onResolve: () => {},
    },
    {
      id: 'spinning_crane_kick',
      name: 'Spinning Crane Kick',
      icon: 'ability_monk_cranekick_new',
      spellId: 101546,
      displayStacks: (s) => s.stacks('player', 'dance_proc'),
      usable: (s) => {
        if (s.stacks('player', 'dance_proc') > 0) return true // Dance of Chi-Ji: free
        return chi(s) >= (zenithActive(s) ? 1 : 2) ? true : 'requires 2 Chi'
      },
      onResolve: (s) => {
        const free = s.stacks('player', 'dance_proc') > 0
        if (free) s.consumeStack('player', 'dance_proc')
        else spendChi(s, zenithActive(s) ? 1 : 2)
        // S2 4pc: SCK consumes Unbroken Rhythm at +20%/stack (AoE-leaning use)
        const ur = 1 + 0.2 * s.stacks('player', 'unbroken_rhythm')
        if (s.stacks('player', 'unbroken_rhythm') > 0) s.removeAura('player', 'unbroken_rhythm')
        s.damage('spinning_crane_kick', SCK_COEFF * comboMult(s, 'spinning_crane_kick') * ur)
        if (zenithActive(s)) flurryStrikes(s, 3) // Wisdom of the Wall (Shado-Pan)
      },
    },
    {
      id: 'whirling_dragon_punch',
      name: 'Whirling Dragon Punch',
      icon: 'ability_monk_hurricanestrike',
      spellId: 152175,
      cooldown: 24,
      usable: (s) =>
        (s.cooldownRemains('rising_sun_kick') > 0 && s.cooldownRemains('fists_of_fury') > 0
          ? true
          : 'requires Rising Sun Kick and Fists of Fury on cooldown'),
      onResolve: (s) => {
        const mult = comboMult(s, 'whirling_dragon_punch')
        for (let i = 0; i < 3; i++) {
          s.schedule(s.time + i * 0.4, () => s.damage('whirling_dragon_punch', WDP_PULSE * mult))
        }
      },
    },
    {
      id: 'strike_of_the_windlord',
      name: 'Strike of the Windlord',
      icon: 'inv_hand_1h_artifactskywall_d_01',
      spellId: 392983,
      cooldown: 40,
      usable: (s) => (chi(s) >= (zenithActive(s) ? 1 : 2) ? true : 'requires 2 Chi'),
      onResolve: (s) => {
        spendChi(s, zenithActive(s) ? 1 : 2)
        s.damage('strike_of_the_windlord', SOTW_COEFF * comboMult(s, 'strike_of_the_windlord'))
        rollDance(s)
      },
    },
    {
      id: 'slicing_winds',
      name: 'Slicing Winds',
      icon: 'ability_monk_quitornado',
      cooldown: 30,
      onResolve: (s) => {
        s.damage('slicing_winds', SLICE_COEFF * comboMult(s, 'slicing_winds'))
      },
    },
    {
      id: 'zenith',
      name: 'Zenith',
      icon: 'ability_monk_serenity',
      cooldown: 90,
      charges: 2,
      onResolve: (s) => {
        // Tigereye Brew (Apex): consume stacks for +1% crit each (flat stand-in)
        s.data.zenith_mult = 1 + 0.01 * (s.data.tigereye ?? 0)
        s.data.tigereye = 0
        s.applyAura('player', 'zenith')
        s.resetCooldown('rising_sun_kick')
        // activation Zenith Stomp: big Nature hit + 2 Chi
        s.damage('zenith_stomp', STOMP_COEFF * comboMult(s, 'zenith'))
        gainChi(s, 2)
        gainFlurry(s, 10) // Shado-Pan: Zenith banks Flurry Charges
      },
    },
    {
      id: 'zenith_stomp',
      name: 'Zenith Stomp',
      icon: 'ability_monk_legsweep',
      usable: (s) => (zenithActive(s) ? true : 'requires Zenith'),
      onResolve: (s) => {
        s.damage('zenith_stomp', STOMP_COEFF * comboMult(s, 'zenith_stomp'))
        gainChi(s, 2)
      },
    },
    {
      id: 'touch_of_death',
      name: 'Touch of Death',
      icon: 'ability_monk_touchofdeath',
      spellId: 322109,
      cooldown: 90,
      onResolve: (s) => {
        s.damage('touch_of_death', TOD_COEFF * comboMult(s, 'touch_of_death'), { canCrit: false })
      },
    },
    {
      id: 'invoke_xuen',
      name: 'Invoke Xuen, the White Tiger',
      icon: 'ability_monk_summontigerstatue',
      spellId: 123904,
      cooldown: 120,
      onResolve: (s) => {
        comboMult(s, 'invoke_xuen')
        for (let i = 1; i <= 10; i++) {
          s.schedule(s.time + i * 2, () => s.damage('Xuen', XUEN_PULSE))
        }
      },
    },
  ],

  actionBar: [
    'tiger_palm', 'blackout_kick', 'rising_sun_kick', 'fists_of_fury',
    'spinning_crane_kick', 'whirling_dragon_punch', 'strike_of_the_windlord',
    'slicing_winds', 'zenith', 'zenith_stomp', 'touch_of_death', 'invoke_xuen',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'blackout_kick': return s.stacks('player', 'bok_proc') > 0
      case 'rising_sun_kick': return s.auraRemains('player', 'rwk_proc') > 0
      case 'spinning_crane_kick': return s.stacks('player', 'dance_proc') > 0
      case 'zenith_stomp': return zenithActive(s) && s.stacks('player', 'chi') <= 2
      case 'whirling_dragon_punch':
        return s.cooldownRemains('whirling_dragon_punch') === 0
          && s.cooldownRemains('rising_sun_kick') > 0 && s.cooldownRemains('fists_of_fury') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'whirling_dragon_punch', text: 'During its window — RSK and FoF both on cooldown', when: s => s.cooldownRemains('whirling_dragon_punch') === 0 && s.cooldownRemains('rising_sun_kick') > 0 && s.cooldownRemains('fists_of_fury') > 0 },
    { abilityId: 'zenith_stomp', text: 'During Zenith if low on Chi or the window is about to end', when: s => zenithActive(s) && (s.stacks('player', 'chi') <= 2 || (s.auraRemains('player', 'zenith') < 2.5 && s.stacks('player', 'chi') <= 3)) },
    { abilityId: 'tiger_palm', text: 'Emergency: <4 Chi, <2 Blackout Kick! stacks, about to cap Energy, not during Zenith', when: s => !zenithActive(s) && s.stacks('player', 'chi') < 4 && s.stacks('player', 'bok_proc') < 2 && s.insanity >= 85 },
    { abilityId: 'invoke_xuen', text: 'On cooldown', when: s => s.cooldownRemains('invoke_xuen') === 0 },
    { abilityId: 'zenith', text: 'Spend charges — opener pairs it with Xuen; don\'t sit at 2 charges', when: s => s.chargesOf('zenith') > 0 && !zenithActive(s) },
    { abilityId: 'fists_of_fury', text: 'On cooldown with enough Chi — unleashes Flurry Charges; let the channel finish', when: s => s.cooldownRemains('fists_of_fury') === 0 && s.stacks('player', 'chi') >= (zenithActive(s) ? 2 : 3) },
    { abilityId: 'strike_of_the_windlord', text: 'On cooldown with enough Chi', when: s => s.cooldownRemains('strike_of_the_windlord') === 0 && s.stacks('player', 'chi') >= (zenithActive(s) ? 1 : 2) },
    { abilityId: 'rising_sun_kick', label: 'Rushing Wind Kick', icon: 'ability_monk_rushingjadewind', text: 'Rushing Wind Kick when it procs (free)', when: s => s.auraRemains('player', 'rwk_proc') > 0 && s.cooldownRemains('rising_sun_kick') === 0 },
    { abilityId: 'rising_sun_kick', text: 'On cooldown with enough Chi — consumes Unbroken Rhythm (4pc)', when: s => s.cooldownRemains('rising_sun_kick') === 0 && s.stacks('player', 'chi') >= (zenithActive(s) ? 1 : 2) },
    { abilityId: 'blackout_kick', text: 'With 2 Blackout Kick! stacks, or free during Zenith (extra cooldown reduction)', when: s => s.stacks('player', 'bok_proc') >= 2 || zenithActive(s) },
    { abilityId: 'spinning_crane_kick', text: 'With a Dance of Chi-Ji proc, or dumping >4 Chi during Zenith', when: s => s.stacks('player', 'dance_proc') > 0 || (zenithActive(s) && s.stacks('player', 'chi') > 4) },
    { abilityId: 'touch_of_death', text: 'On cooldown — don\'t delay higher-priority abilities for it', when: s => s.cooldownRemains('touch_of_death') === 0 },
    { abilityId: 'slicing_winds', text: 'Filler when off cooldown', when: s => s.cooldownRemains('slicing_winds') === 0 },
    { abilityId: 'tiger_palm', text: 'Build Chi at ≤3 (never cap Chi or Energy)' },
    { abilityId: 'blackout_kick', text: 'Chi dump / filler — never repeat any ability (Combo Strikes)' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Fists of Fury
    const c = chi(s)
    const energy = s.insanity
    const zen = zenithActive(s)
    const bokStacks = s.stacks('player', 'bok_proc')
    const bokFree = bokStacks > 0 || zen
    const rwk = s.auraRemains('player', 'rwk_proc') > 0
    const dance = s.stacks('player', 'dance_proc') > 0
    const differs = (id: string) => s.data.last_strike !== STRIKE_IDX[id]

    if (s.cooldownRemains('whirling_dragon_punch') === 0
      && s.cooldownRemains('rising_sun_kick') > 0 && s.cooldownRemains('fists_of_fury') > 0
      && differs('whirling_dragon_punch')) return 'whirling_dragon_punch'
    if (zen && (c <= 2 || (s.auraRemains('player', 'zenith') < 2.5 && c <= 3))
      && differs('zenith_stomp')) return 'zenith_stomp'
    if (!zen && c < 4 && bokStacks < 2 && energy >= 85 && differs('tiger_palm')) return 'tiger_palm'
    if (s.cooldownRemains('invoke_xuen') === 0) return 'invoke_xuen'
    if (s.chargesOf('zenith') > 0 && !zen) return 'zenith'
    if (s.cooldownRemains('fists_of_fury') === 0 && c >= (zen ? 2 : 3) && differs('fists_of_fury')) return 'fists_of_fury'
    if (s.cooldownRemains('strike_of_the_windlord') === 0 && c >= (zen ? 1 : 2) && differs('strike_of_the_windlord')) return 'strike_of_the_windlord'
    if (rwk && s.cooldownRemains('rising_sun_kick') === 0 && differs('rising_sun_kick')) return 'rising_sun_kick'
    if (s.cooldownRemains('rising_sun_kick') === 0 && c >= (zen ? 1 : 2) && differs('rising_sun_kick')) return 'rising_sun_kick'
    if ((bokStacks >= 2 || zen) && (bokFree || c >= 1) && differs('blackout_kick')) return 'blackout_kick'
    if ((dance || (zen && c > 4)) && (dance || c >= (zen ? 1 : 2)) && differs('spinning_crane_kick')) return 'spinning_crane_kick'
    if (s.cooldownRemains('touch_of_death') === 0 && differs('touch_of_death')) return 'touch_of_death'
    if (s.cooldownRemains('slicing_winds') === 0 && differs('slicing_winds')) return 'slicing_winds'
    if (c <= 3 && energy >= 50 && differs('tiger_palm')) return 'tiger_palm'
    if ((c >= 1 || bokFree) && differs('blackout_kick')) return 'blackout_kick'
    return null // pool Energy — Windwalker naturally has downtime
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['tiger_palm', 'blackout_kick', 'slicing_winds']
    const kicks = ['rising_sun_kick', 'strike_of_the_windlord', 'whirling_dragon_punch']
    const sets = [fillers, kicks]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
