import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Windwalker Monk — patch 12.1.0 (Midnight, Season 2), Conduit of the
 * Celestials raid ST build (Icy Veins default). Built from the simc
 * `midnight` APL/source and Icy Veins/Wowhead 12.1 guides.
 *
 * Resource model: Energy (max 100) with a hasted regen loop; Chi is an
 * aura stack pool (max 5). Mastery: Combo Strikes — every ability that
 * differs from the previous one hits 15% harder (fixed mastery stand-in,
 * no mastery input yet), and the oracle never repeats an ability.
 * Talent assumptions: Rising Sun Kick build, Whirling Dragon Punch,
 * Strike of the Windlord, Invoke Xuen; Conduit of the Celestials folded
 * into Rising Sun Kick's Flight of the Red Crane proc (APPROX).
 * Apex: Way of the Thousand Fists 3/3 — every 4th Combo Strike echoes as
 * a Thousand Fists hit. S2 tier: 2pc Strike of the Windlord +30% (folded);
 * 4pc Fists of Fury's final tick refunds 1 Chi.
 * APPROX-flagged: auto cadence, energy regen curve, Blackout Kick! proc
 * rate, Xuen modeled as 10 scheduled pulses. Damage in AP units.
 */

const AUTO_COEFF = 0.22
const TP_COEFF = 0.55
const RSK_COEFF = 1.8
const BOK_COEFF = 0.85
const FOF_TICK = 1.05          // 5 ticks
const WDP_PULSE = 0.65         // 3 pulses
const SOTW_COEFF = 2.9         // incl. S2 2pc +30%
const XUEN_PULSE = 0.38        // 10 pulses over 20s
const RED_CRANE_COEFF = 0.55
const RED_CRANE_CHANCE = 0.25  // APPROX: Conduit folded into RSK
const TF_COEFF = 0.5           // Apex echo
const COMBO_MULT = 1.15
const BOK_PROC_CHANCE = 0.15   // APPROX: Blackout Kick! per Tiger Palm

const STRIKE_IDX: Record<string, number> = {
  tiger_palm: 1,
  rising_sun_kick: 2,
  blackout_kick: 3,
  fists_of_fury: 4,
  whirling_dragon_punch: 5,
  strike_of_the_windlord: 6,
}

function chi(s: SimAPI): number {
  return s.stacks('player', 'chi')
}

function gainChi(s: SimAPI, n: number) {
  s.applyAura('player', 'chi', { stacks: n })
}

function spendChi(s: SimAPI, n: number) {
  for (let i = 0; i < n; i++) s.consumeStack('player', 'chi')
}

/** Mastery: Combo Strikes + the Apex Thousand Fists counter */
function comboMult(s: SimAPI, id: string): number {
  const idx = STRIKE_IDX[id]
  const mult = s.data.last_strike === idx ? 1 : COMBO_MULT
  s.data.last_strike = idx
  if (mult > 1) {
    s.data.combo_count = (s.data.combo_count ?? 0) + 1
    if (s.data.combo_count >= 4) {
      s.data.combo_count -= 4
      s.damage('Thousand Fists', TF_COEFF) // Apex echo
    }
  }
  return mult
}

export const windwalkerMonk: SpecConfig = {
  name: 'Windwalker Monk',
  specId: 'monk-windwalker',
  specIcon: 'spell_monk_windwalker_spec',
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

  auras: [
    { id: 'chi', name: 'Chi', icon: 'ability_monk_healthsphere', duration: Infinity, maxStacks: 5 },
    { id: 'bok_proc', name: 'Blackout Kick!', icon: 'ability_monk_roundhousekick', duration: 15 },
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
        if (s.rng('bok_proc') < BOK_PROC_CHANCE) s.applyAura('player', 'bok_proc')
      },
    },
    {
      id: 'rising_sun_kick',
      name: 'Rising Sun Kick',
      icon: 'ability_monk_risingsunkick',
      spellId: 107428,
      cooldown: 10,
      usable: (s) => (chi(s) >= 2 ? true : 'requires 2 Chi'),
      onResolve: (s) => {
        spendChi(s, 2)
        s.damage('rising_sun_kick', RSK_COEFF * comboMult(s, 'rising_sun_kick'))
        // Conduit of the Celestials: Red Crane swoops in (folded proc)
        if (s.rng('red_crane') < RED_CRANE_CHANCE) s.damage('Flight of the Red Crane', RED_CRANE_COEFF)
      },
    },
    {
      id: 'blackout_kick',
      name: 'Blackout Kick',
      icon: 'ability_monk_roundhousekick',
      spellId: 100784,
      usable: (s) => (chi(s) >= 1 || s.auraRemains('player', 'bok_proc') > 0 ? true : 'requires 1 Chi'),
      onResolve: (s) => {
        if (s.auraRemains('player', 'bok_proc') > 0) s.removeAura('player', 'bok_proc')
        else spendChi(s, 1)
        s.damage('blackout_kick', BOK_COEFF * comboMult(s, 'blackout_kick'))
        s.reduceCooldown('rising_sun_kick', 1)
        s.reduceCooldown('fists_of_fury', 1)
      },
    },
    {
      id: 'fists_of_fury',
      name: 'Fists of Fury',
      icon: 'monk_ability_fistoffury',
      spellId: 113656,
      cooldown: 24,
      usable: (s) => (chi(s) >= 3 ? true : 'requires 3 Chi'),
      onCastStart: (s) => {
        spendChi(s, 3)
        s.data.fof_mult = comboMult(s, 'fists_of_fury')
      },
      channel: {
        duration: 4,
        ticks: 5,
        hasted: true,
        onTick: (s, i) => {
          s.damage('fists_of_fury', FOF_TICK * (s.data.fof_mult ?? 1))
          if (i === 5) gainChi(s, 1) // S2 4pc
        },
      },
      onResolve: () => {},
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
      usable: (s) => (chi(s) >= 2 ? true : 'requires 2 Chi'),
      onResolve: (s) => {
        spendChi(s, 2)
        s.damage('strike_of_the_windlord', SOTW_COEFF * comboMult(s, 'strike_of_the_windlord'))
      },
    },
    {
      id: 'invoke_xuen',
      name: 'Invoke Xuen, the White Tiger',
      icon: 'ability_monk_summontigerstatue',
      spellId: 123904,
      cooldown: 120,
      onResolve: (s) => {
        for (let i = 1; i <= 10; i++) {
          s.schedule(s.time + i * 2, () => s.damage('Xuen', XUEN_PULSE))
        }
      },
    },
  ],

  actionBar: [
    'tiger_palm', 'rising_sun_kick', 'blackout_kick', 'fists_of_fury',
    'whirling_dragon_punch', 'strike_of_the_windlord', 'invoke_xuen',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'blackout_kick': return s.auraRemains('player', 'bok_proc') > 0
      case 'whirling_dragon_punch':
        return s.cooldownRemains('whirling_dragon_punch') === 0
          && s.cooldownRemains('rising_sun_kick') > 0 && s.cooldownRemains('fists_of_fury') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'invoke_xuen', text: 'On cooldown', when: s => s.cooldownRemains('invoke_xuen') === 0 },
    { abilityId: 'strike_of_the_windlord', text: 'On cooldown with 2 Chi', when: s => s.cooldownRemains('strike_of_the_windlord') === 0 && s.stacks('player', 'chi') >= 2 },
    { abilityId: 'rising_sun_kick', text: 'On cooldown with 2 Chi', when: s => s.cooldownRemains('rising_sun_kick') === 0 && s.stacks('player', 'chi') >= 2 },
    { abilityId: 'whirling_dragon_punch', text: 'While RSK and FoF are both on cooldown', when: s => s.cooldownRemains('whirling_dragon_punch') === 0 && s.cooldownRemains('rising_sun_kick') > 0 && s.cooldownRemains('fists_of_fury') > 0 },
    { abilityId: 'fists_of_fury', text: 'On cooldown with 3 Chi — let the channel finish', when: s => s.cooldownRemains('fists_of_fury') === 0 && s.stacks('player', 'chi') >= 3 },
    { abilityId: 'tiger_palm', text: 'Build Chi at ≤3 (never cap Chi or Energy)' },
    { abilityId: 'blackout_kick', text: 'Chi dump / filler — never repeat any ability (Combo Strikes)' },
  ],

  policy: (s) => {
    if (s.casting?.channel) return null // never clip Fists of Fury
    const c = chi(s)
    const energy = s.insanity
    const bokProc = s.auraRemains('player', 'bok_proc') > 0
    const differs = (id: string) => s.data.last_strike !== STRIKE_IDX[id]

    if (s.cooldownRemains('invoke_xuen') === 0) return 'invoke_xuen'
    if (s.cooldownRemains('strike_of_the_windlord') === 0 && c >= 2 && differs('strike_of_the_windlord')) return 'strike_of_the_windlord'
    if (s.cooldownRemains('rising_sun_kick') === 0 && c >= 2 && differs('rising_sun_kick')) return 'rising_sun_kick'
    if (s.cooldownRemains('whirling_dragon_punch') === 0
      && s.cooldownRemains('rising_sun_kick') > 0 && s.cooldownRemains('fists_of_fury') > 0
      && differs('whirling_dragon_punch')) return 'whirling_dragon_punch'
    if (s.cooldownRemains('fists_of_fury') === 0 && c >= 3 && differs('fists_of_fury')) return 'fists_of_fury'
    if (c <= 3 && energy >= 50 && differs('tiger_palm')) return 'tiger_palm'
    if ((c >= 1 || bokProc) && differs('blackout_kick')) return 'blackout_kick'
    return null // wait for Energy
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['tiger_palm', 'blackout_kick']
    const kicks = ['rising_sun_kick', 'strike_of_the_windlord', 'whirling_dragon_punch']
    const sets = [fillers, kicks]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
