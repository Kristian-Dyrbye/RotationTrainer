import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Windwalker Monk — patch 12.1.0 (Midnight, Season 2), Conduit of the
 * Celestials raid ST build (alternate to the default Shado-Pan build).
 * Method calls Conduit "technically stronger than Shado-Pan in all
 * content" but significantly more complex; Icy Veins publishes its
 * talent string as the Mythic+/Delves build. Verified against live
 * guides 2026-08-24:
 *   - Wowhead rotation guide: https://www.wowhead.com/guide/classes/monk/windwalker/rotation-cooldowns-pve-dps
 *   - Method playstyle/rotation (Conduit priority + opener): https://www.method.gg/guides/windwalker-monk/playstyle-and-rotation
 *   - Icy Veins rotation (Conduit ST list, Heart of the Jade Serpent notes): https://www.icy-veins.com/wow/windwalker-monk-pve-dps-rotation-cooldowns-abilities
 *   - Icy Veins builds (talent string source): https://www.icy-veins.com/wow/windwalker-monk-pve-dps-spec-builds-talents
 *
 * Shares the Midnight chassis with spec.ts: Energy (max 100, hasted
 * regen) + Chi as an aura stack pool (max 5); Mastery: Combo Strikes
 * (never repeat an ability, +15% stand-in); Zenith (2 charges) damage
 * window with Zenith Stomp, cost reduction and doubled Blackout Kick
 * CDR; Rushing Wind Kick transform procs; Apex Tigereye Brew; S2 tier
 * (2pc extra Fists of Fury strike, 4pc Unbroken Rhythm — the Conduit
 * build consumes it with Spinning Crane Kick per Method's list).
 *
 * Conduit of the Celestials kit modeled:
 *   - Heart of the Jade Serpent: Strike of the Windlord and Whirling
 *     Dragon Punch call Yu'lon — RSK/FoF/SotW/WDP cooldowns recover 75%
 *     faster for 8s (+10% haste while active, Yu'lon's Knowledge-style).
 *     Zenith grants a 4s instance; guide rule modeled: cast Celestial
 *     Conduit only when no Heart of the Jade Serpent is active, spacing
 *     it between SotW/WDP casts (the non-stacking instances are folded
 *     into one refreshing buff — APPROX).
 *   - Celestial Conduit: 90s cooldown channel that also opens a Heart
 *     of the Jade Serpent window; ends with Unity Within, invoking all
 *     four celestials (modeled as a scheduled burst).
 *   - Flight of the Red Crane: Fists of Fury ticks and Spinning Crane
 *     Kick can call the Red Crane; Courage of the White Tiger: Tiger
 *     Palm can call the White Tiger's claw strike.
 *   - No Shado-Pan Flurry Strikes; Slicing Winds not taken in this
 *     build (absent from Method's Conduit priority).
 *
 * APPROX-flagged: all damage coefficients (AP units, relative
 * magnitudes only), auto cadence, energy regen curve, Zenith duration
 * (15s) / recharge (90s), Blackout Kick!/Rushing Wind Kick/Dance of
 * Chi-Ji proc rates, Red Crane / White Tiger proc rates, Heart of the
 * Jade Serpent folded stacking + 10% haste rider, Celestial Conduit
 * channel shape (8 ticks over 4s) and Unity Within as one burst, Xuen
 * as 10 scheduled pulses, Touch of Death as a flat 90s-cooldown hit.
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
const XUEN_PULSE = 0.38        // 10 pulses over 20s
const CC_TICK = 0.9            // Celestial Conduit, 8 channel ticks (APPROX)
const UNITY_COEFF = 2.2        // Unity Within: all four celestials as one burst (APPROX)
const RED_CRANE_COEFF = 0.5    // Flight of the Red Crane swoop (APPROX)
const WHITE_TIGER_COEFF = 0.45 // Courage of the White Tiger claw strike (APPROX)
const COMBO_MULT = 1.15
const ZENITH_DURATION = 15     // APPROX: window length unpublished
const HOTJS_DURATION = 8       // Heart of the Jade Serpent (SotW/WDP/Conduit)
const HOTJS_ZENITH = 4         // Zenith's shorter Heart of the Jade Serpent
const HOTJS_CDR_RATE = 0.75    // cooldowns recover 75% faster
const HOTJS_HASTE = 0.10       // haste rider while active (APPROX)
const BOK_PROC_CHANCE = 0.15   // APPROX: Blackout Kick! per Tiger Palm
const RWK_PROC_CHANCE = 0.4    // per Blackout Kick (wow.gg tooltip mining)
const DANCE_PROC_CHANCE = 0.2  // APPROX: Dance of Chi-Ji per Chi spender
const RED_CRANE_CHANCE = 0.2   // APPROX: per FoF tick / SCK
const WHITE_TIGER_CHANCE = 0.25 // APPROX: per Tiger Palm

/** abilities whose cooldowns Heart of the Jade Serpent accelerates */
const HOTJS_ABILITIES = [
  'rising_sun_kick', 'fists_of_fury', 'strike_of_the_windlord', 'whirling_dragon_punch',
]

const STRIKE_IDX: Record<string, number> = {
  tiger_palm: 1,
  rising_sun_kick: 2,
  blackout_kick: 3,
  fists_of_fury: 4,
  whirling_dragon_punch: 5,
  strike_of_the_windlord: 6,
  spinning_crane_kick: 7,
  zenith_stomp: 8,
  celestial_conduit: 9,
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

function hotjsActive(s: SimAPI): boolean {
  return s.auraRemains('player', 'hotjs') > 0
}

/** Mastery: Combo Strikes — differs from the last strike → 15% more */
function comboMult(s: SimAPI, id: string): number {
  const idx = STRIKE_IDX[id]
  const mult = s.data.last_strike === idx ? 1 : COMBO_MULT
  s.data.last_strike = idx
  return mult
}

/** Dance of Chi-Ji: chance on Chi-spender casts, banks to 2 */
function rollDance(s: SimAPI) {
  if (s.rng('dance_proc') < DANCE_PROC_CHANCE) s.applyAura('player', 'dance_proc', { stacks: 1 })
}

/** Flight of the Red Crane: FoF ticks / SCK can call the Red Crane */
function rollRedCrane(s: SimAPI) {
  if (s.rng('red_crane') < RED_CRANE_CHANCE) s.damage('Flight of the Red Crane', RED_CRANE_COEFF)
}

export const windwalkerConduit: SpecConfig = {
  name: 'Windwalker Monk',
  specId: 'monk-windwalker',
  specIcon: 'spell_monk_windwalker_spec',
  buildId: 'conduit-of-the-celestials',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/monk/windwalker/rotation-cooldowns-pve-dps',
    buildName: 'Windwalker Conduit of the Celestials — raid ST alternate (Method rotation; Icy Veins publishes the string as "Windwalker Mythic+ / Delves - Conduit of the Celestials")',
    heroTalent: 'Conduit of the Celestials',
    // published verbatim as "Windwalker Mythic+ - Conduit of the Celestials"
    // (and identically for Delves) on
    // icy-veins.com/wow/windwalker-monk-pve-dps-spec-builds-talents (2026-08-24)
    talentString: 'C0QAAAAAAAAAAAAAAAAAAAAAAMzYMgxYZmZ2mBAAAAAAAAAAAYZYEmhhBMjhZmZGmNMDzyMBAswsxMmZmZAAsYmlZZMBAAmZGAzAMWGDYmZ2M',
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
      s.schedule(s.time + 1.4 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.2, swing)
  },

  // Tigereye Brew payout: flat damage multiplier while Zenith is up
  damageMult: (s) => (zenithActive(s) ? s.data.zenith_mult ?? 1 : 1),

  // Heart of the Jade Serpent haste rider (APPROX, Yu'lon's Knowledge-style)
  hasteMod: (s) => (hotjsActive(s) ? HOTJS_HASTE : 0),

  auras: [
    { id: 'chi', name: 'Chi', icon: 'ability_monk_healthsphere', duration: Infinity, maxStacks: 5 },
    { id: 'zenith', name: 'Zenith', icon: 'ability_monk_serenity', duration: ZENITH_DURATION },
    {
      id: 'hotjs',
      name: 'Heart of the Jade Serpent',
      icon: 'ability_monk_summonserpentstatue',
      duration: HOTJS_DURATION,
      // Yu'lon: RSK/FoF/SotW/WDP cooldowns recover 75% faster while active
      onApply: (s) => {
        if (s.data.hotjs_loop) return
        s.data.hotjs_loop = 1
        const tick = () => {
          if (s.auraRemains('player', 'hotjs') <= 0) {
            s.data.hotjs_loop = 0
            return
          }
          for (const id of HOTJS_ABILITIES) s.reduceCooldown(id, 0.25 * HOTJS_CDR_RATE)
          s.schedule(s.time + 0.25, tick)
        }
        s.schedule(s.time + 0.25, tick)
      },
    },
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
        // Courage of the White Tiger: the White Tiger's claw strike (Conduit)
        if (s.rng('white_tiger') < WHITE_TIGER_CHANCE) s.damage('Courage of the White Tiger', WHITE_TIGER_COEFF)
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
        const mult = comboMult(s, 'rising_sun_kick')
        if (rushing) s.damage('rushing_wind_kick', RSK_COEFF * RWK_MULT * mult)
        else s.damage('rising_sun_kick', RSK_COEFF * mult)
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
        rollDance(s)
      },
      channel: {
        duration: 4,
        ticks: 5,
        hasted: true,
        onTick: (s) => {
          s.damage('fists_of_fury', FOF_TICK * (s.data.fof_mult ?? 1))
          s.applyAura('player', 'unbroken_rhythm', { stacks: 1 }) // S2 4pc
          rollRedCrane(s) // Flight of the Red Crane (Conduit)
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
        // S2 4pc: the Conduit build consumes Unbroken Rhythm with SCK
        // (+20%/stack) per Method's priority list
        const ur = 1 + 0.2 * s.stacks('player', 'unbroken_rhythm')
        if (s.stacks('player', 'unbroken_rhythm') > 0) s.removeAura('player', 'unbroken_rhythm')
        s.damage('spinning_crane_kick', SCK_COEFF * comboMult(s, 'spinning_crane_kick') * ur)
        rollRedCrane(s) // Flight of the Red Crane (Conduit)
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
        // calls Yu'lon: Heart of the Jade Serpent (Conduit)
        s.applyAura('player', 'hotjs', { duration: HOTJS_DURATION })
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
        // calls Yu'lon: Heart of the Jade Serpent (Conduit)
        s.applyAura('player', 'hotjs', { duration: HOTJS_DURATION })
        rollDance(s)
      },
    },
    {
      id: 'celestial_conduit',
      name: 'Celestial Conduit',
      icon: 'inv_ability_conduitofthecelestialsmonk_celestialconduit',
      spellId: 443028,
      cooldown: 90,
      onCastStart: (s) => {
        s.data.cc_mult = comboMult(s, 'celestial_conduit')
        // the channel opens its own Heart of the Jade Serpent window
        s.applyAura('player', 'hotjs', { duration: HOTJS_DURATION })
      },
      channel: {
        duration: 4,
        ticks: 8,
        hasted: true,
        onTick: (s, i) => {
          s.damage('celestial_conduit', CC_TICK * (s.data.cc_mult ?? 1))
          // Unity Within caps the channel: all four celestials answer
          // (single burst on the final tick — APPROX)
          if (i === 8) s.damage('Unity Within', UNITY_COEFF * (s.data.cc_mult ?? 1))
        },
      },
      onResolve: () => {},
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
        // Conduit: Zenith grants a short Heart of the Jade Serpent
        s.applyAura('player', 'hotjs', { duration: HOTJS_ZENITH })
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
    'celestial_conduit', 'zenith', 'zenith_stomp', 'touch_of_death', 'invoke_xuen',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'blackout_kick': return s.stacks('player', 'bok_proc') > 0
      case 'rising_sun_kick': return s.auraRemains('player', 'rwk_proc') > 0
      case 'spinning_crane_kick': return s.stacks('player', 'dance_proc') > 0
      case 'zenith_stomp': return zenithActive(s) && s.stacks('player', 'chi') <= 2
      case 'celestial_conduit': return s.cooldownRemains('celestial_conduit') === 0 && !hotjsActive(s)
      case 'whirling_dragon_punch':
        return s.cooldownRemains('whirling_dragon_punch') === 0
          && s.cooldownRemains('rising_sun_kick') > 0 && s.cooldownRemains('fists_of_fury') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'whirling_dragon_punch', text: 'During its window (RSK and FoF on cooldown) — calls Yu\'lon: Heart of the Jade Serpent', when: s => s.cooldownRemains('whirling_dragon_punch') === 0 && s.cooldownRemains('rising_sun_kick') > 0 && s.cooldownRemains('fists_of_fury') > 0 },
    { abilityId: 'zenith_stomp', text: 'During Zenith if low on Chi or the window is about to end', when: s => zenithActive(s) && (s.stacks('player', 'chi') <= 2 || (s.auraRemains('player', 'zenith') < 2.5 && s.stacks('player', 'chi') <= 3)) },
    { abilityId: 'tiger_palm', text: 'Emergency: <4 Chi, <2 Blackout Kick! stacks, about to cap Energy, not during Zenith', when: s => !zenithActive(s) && s.stacks('player', 'chi') < 4 && s.stacks('player', 'bok_proc') < 2 && s.insanity >= 85 },
    { abilityId: 'invoke_xuen', text: 'On cooldown', when: s => s.cooldownRemains('invoke_xuen') === 0 },
    { abilityId: 'zenith', text: 'Spend charges — opener pairs it with Xuen; grants a short Heart of the Jade Serpent', when: s => s.chargesOf('zenith') > 0 && !zenithActive(s) },
    { abilityId: 'celestial_conduit', text: 'Only with no Heart of the Jade Serpent active — space it between Strike of the Windlord and Whirling Dragon Punch', when: s => s.cooldownRemains('celestial_conduit') === 0 && !hotjsActive(s) },
    { abilityId: 'fists_of_fury', text: 'On cooldown with enough Chi — load casts into Heart of the Jade Serpent windows; let the channel finish', when: s => s.cooldownRemains('fists_of_fury') === 0 && s.stacks('player', 'chi') >= (zenithActive(s) ? 2 : 3) },
    { abilityId: 'strike_of_the_windlord', text: 'On cooldown with enough Chi — calls Yu\'lon: Heart of the Jade Serpent', when: s => s.cooldownRemains('strike_of_the_windlord') === 0 && s.stacks('player', 'chi') >= (zenithActive(s) ? 1 : 2) },
    { abilityId: 'rising_sun_kick', label: 'Rushing Wind Kick', icon: 'ability_monk_rushingjadewind', text: 'Rushing Wind Kick when it procs (free)', when: s => s.auraRemains('player', 'rwk_proc') > 0 && s.cooldownRemains('rising_sun_kick') === 0 },
    { abilityId: 'rising_sun_kick', text: 'On cooldown with enough Chi', when: s => s.cooldownRemains('rising_sun_kick') === 0 && s.stacks('player', 'chi') >= (zenithActive(s) ? 1 : 2) },
    { abilityId: 'spinning_crane_kick', text: 'With a Dance of Chi-Ji proc, high Unbroken Rhythm (4pc), or dumping >4 Chi during Zenith', when: s => s.stacks('player', 'dance_proc') > 0 || s.stacks('player', 'unbroken_rhythm') >= 4 || (zenithActive(s) && s.stacks('player', 'chi') > 4) },
    { abilityId: 'blackout_kick', text: 'Only with 2 Blackout Kick! stacks, or free during Zenith (Obsidian Spiral, extra cooldown reduction)', when: s => s.stacks('player', 'bok_proc') >= 2 || zenithActive(s) },
    { abilityId: 'touch_of_death', text: 'On cooldown — don\'t delay higher-priority abilities for it', when: s => s.cooldownRemains('touch_of_death') === 0 },
    { abilityId: 'tiger_palm', text: 'Build Chi at ≤3 (never cap Chi or Energy)' },
    { abilityId: 'blackout_kick', text: 'Chi dump / filler — never repeat any ability (Combo Strikes)' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Fists of Fury / Celestial Conduit
    const c = chi(s)
    const energy = s.insanity
    const zen = zenithActive(s)
    const bokStacks = s.stacks('player', 'bok_proc')
    const bokFree = bokStacks > 0 || zen
    const rwk = s.auraRemains('player', 'rwk_proc') > 0
    const dance = s.stacks('player', 'dance_proc') > 0
    const ur = s.stacks('player', 'unbroken_rhythm')
    const differs = (id: string) => s.data.last_strike !== STRIKE_IDX[id]

    if (s.cooldownRemains('whirling_dragon_punch') === 0
      && s.cooldownRemains('rising_sun_kick') > 0 && s.cooldownRemains('fists_of_fury') > 0
      && differs('whirling_dragon_punch')) return 'whirling_dragon_punch'
    if (zen && (c <= 2 || (s.auraRemains('player', 'zenith') < 2.5 && c <= 3))
      && differs('zenith_stomp')) return 'zenith_stomp'
    if (!zen && c < 4 && bokStacks < 2 && energy >= 85 && differs('tiger_palm')) return 'tiger_palm'
    if (s.cooldownRemains('invoke_xuen') === 0) return 'invoke_xuen'
    if (s.chargesOf('zenith') > 0 && !zen) return 'zenith'
    if (s.cooldownRemains('celestial_conduit') === 0 && !hotjsActive(s) && differs('celestial_conduit')) return 'celestial_conduit'
    if (s.cooldownRemains('fists_of_fury') === 0 && c >= (zen ? 2 : 3) && differs('fists_of_fury')) return 'fists_of_fury'
    if (s.cooldownRemains('strike_of_the_windlord') === 0 && c >= (zen ? 1 : 2) && differs('strike_of_the_windlord')) return 'strike_of_the_windlord'
    if (rwk && s.cooldownRemains('rising_sun_kick') === 0 && differs('rising_sun_kick')) return 'rising_sun_kick'
    if (s.cooldownRemains('rising_sun_kick') === 0 && c >= (zen ? 1 : 2) && differs('rising_sun_kick')) return 'rising_sun_kick'
    if ((dance || ur >= 4 || (zen && c > 4)) && (dance || c >= (zen ? 1 : 2)) && differs('spinning_crane_kick')) return 'spinning_crane_kick'
    if ((bokStacks >= 2 || zen) && (bokFree || c >= 1) && differs('blackout_kick')) return 'blackout_kick'
    if (s.cooldownRemains('touch_of_death') === 0 && differs('touch_of_death')) return 'touch_of_death'
    if (c <= 3 && energy >= 50 && differs('tiger_palm')) return 'tiger_palm'
    if ((c >= 1 || bokFree) && differs('blackout_kick')) return 'blackout_kick'
    return null // pool Energy — Windwalker naturally has downtime
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['tiger_palm', 'blackout_kick']
    const kicks = ['rising_sun_kick', 'strike_of_the_windlord', 'whirling_dragon_punch']
    const sets = [fillers, kicks]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
