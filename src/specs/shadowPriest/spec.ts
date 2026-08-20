import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Shadow Priest — patch 12.1.0 (Midnight, Season 2), Archon raid single-target build
 * with the Season 2 "Cosmic Penitent" 2pc+4pc.
 *
 * Damage numbers are spell-power coefficients from live Wowhead tooltips
 * (2026-08-20). Proc models follow simc's `midnight` branch. Numbers marked
 * APPROX could not be confirmed from any source and need verification against
 * simc SpellQuery — see PLAN.md phase 0.
 *
 * Talent assumptions (Method "Archon Raid" build): Invoked Nightmare,
 * Thought Harvester, Idol of Y'Shaarj, Ancient Madness, Mind Devourer,
 * Apex: Void Apparitions 4/4.
 * Simplifications: no Deathspeaker execute (dummy sits at 100% HP), Ancient
 * Madness haste stacks not modeled (duration extension is), Power Surge
 * modeled as 3 halo waves.
 */

const VOIDFORM_DMG = 1.2
const PI_HASTE = 0.2          // APPROX: 12.1 PI numbers unverified
const APPARITION_COEFF = 0.55 // APPROX: 12.1 apparition coefficient unpublished
const VOID_BOLT_COEFF = 1.5 * 1.35 // Apex Void Bolt, incl. 2026-03-31 +35% hotfix
const VOID_VOLLEY_COEFF = 4.0 // APPROX: tooltip ambiguous (95.44% per-bolt vs total)
const SWM_DOT_TOTAL = 0.5     // APPROX: "small DoT" — exact coefficient unpublished
const MFI_MAX_CHARGES = 2

/** Apex R1/R4 + Idol of Y'Shaarj loop: apparitions stack the idol; idol
 *  activations conjure more apparitions; 30% fly as Void Apparitions. */
function spawnApparitions(s: SimAPI, n: number) {
  for (let i = 0; i < n; i++) {
    const isVoid = s.rng('void_apparition') < 0.30
    s.schedule(s.time + 1.0, () => {
      if (isVoid) {
        s.damage('Shadowy Apparition', APPARITION_COEFF * 1.5)
        s.damage('Void Bolt', VOID_BOLT_COEFF)
      } else {
        s.damage('Shadowy Apparition', APPARITION_COEFF)
      }
    })
    s.data.yshaarj = (s.data.yshaarj ?? 0) + 1
    if (s.data.yshaarj >= 25) {
      s.data.yshaarj -= 25
      spawnApparitions(s, 4) // idol activation conjures apparitions (Apex R1)
    }
  }
}

function grantVoidVolley(s: SimAPI, n: number) {
  s.applyAura('player', 'void_volley_charge', { stacks: n })
}

export const shadowPriest: SpecConfig = {
  name: 'Shadow Priest',
  specId: 'priest-shadow',
  resourceName: 'Insanity',
  resourceMax: 100,
  startingResource: 0,

  auras: [
    {
      id: 'swp_dot',
      name: 'Shadow Word: Pain',
      icon: 'spell_shadow_shadowwordpain',
      duration: 16,
      pandemic: true,
      debuff: true,
      tick: {
        interval: 2,
        hasted: true,
        onTick: (s) => {
          // Invoked Nightmare: SW:P damage +150%. 99.68% SP total / 8 ticks.
          s.damage('swp_dot', (0.9968 / 8) * 2.5)
          // Shadowy Insight: simc threshold-RNG, avg 0.08 per SW:P tick
          s.data.si_acc = (s.data.si_acc ?? 0) + 0.08 * s.rng('shadowy_insight') * 2
          if (s.data.si_acc >= 1) {
            s.data.si_acc -= 1
            s.applyAura('player', 'shadowy_insight')
          }
        },
      },
    },
    {
      id: 'vt_dot',
      name: 'Vampiric Touch',
      icon: 'spell_holy_stoicism',
      duration: 21,
      pandemic: true,
      debuff: true,
      tick: {
        interval: 3,
        hasted: true,
        // 304.343% SP total / 7 ticks (reading flagged ambiguous in research)
        onTick: (s) => s.damage('vt_dot', 3.04343 / 7),
      },
    },
    {
      id: 'swm_dot',
      name: 'Shadow Word: Madness',
      icon: 'inv12_ability_priest_powerwordmadness_eye',
      duration: 6,
      rollover: true, // remaining damage folds into the refresh — never clips
      debuff: true,
      tick: {
        interval: 2,
        hasted: true,
        onTick: (s) => s.damage('swm_dot', SWM_DOT_TOTAL / 3),
      },
    },
    {
      id: 'voidform',
      name: 'Voidform',
      icon: 'spell_priest_void-blast',
      duration: 20,
    },
    {
      id: 'power_infusion',
      name: 'Power Infusion',
      icon: 'spell_holy_powerinfusion',
      duration: 15,
    },
    {
      id: 'shadowy_insight',
      name: 'Shadowy Insight',
      icon: 'spell_shadow_possession',
      duration: 15, // APPROX: buff duration unpublished
    },
    {
      id: 'mind_devourer',
      name: 'Mind Devourer',
      icon: 'spell_arcane_mindmastery',
      duration: 15, // APPROX: buff duration unpublished
    },
    {
      id: 'mfi_charge',
      name: 'Mind Flay: Insanity',
      icon: 'spell_fire_twilightflamebreath',
      duration: 20, // APPROX
      maxStacks: MFI_MAX_CHARGES,
    },
    {
      id: 'void_volley_charge',
      name: 'Void Volley',
      icon: 'inv12_ability_priest_voidvolley',
      duration: 30, // APPROX: charge lifetime unpublished
      maxStacks: 10, // simc fallback_void_volley_max_stacks
    },
  ],

  abilities: [
    {
      id: 'shadow_word_pain',
      name: 'Shadow Word: Pain',
      icon: 'spell_shadow_shadowwordpain',
      spellId: 589,
      onResolve: (s) => {
        s.gain(3, 'swp')
        s.damage('shadow_word_pain', 0.168 * 2.5) // Invoked Nightmare
        s.applyAura('target', 'swp_dot')
      },
    },
    {
      id: 'vampiric_touch',
      name: 'Vampiric Touch',
      icon: 'spell_holy_stoicism',
      spellId: 34914,
      castTime: 1.5,
      onResolve: (s) => {
        s.gain(4, 'vt')
        s.applyAura('target', 'vt_dot')
      },
    },
    {
      id: 'mind_blast',
      name: 'Mind Blast',
      icon: 'spell_shadow_unholyfrenzy',
      spellId: 8092,
      castTime: 1.5,
      cooldown: 9,
      charges: 2, // Thought Harvester
      castTimeMod: (s, base) => (s.stacks('player', 'shadowy_insight') > 0 ? 0 : base),
      noCooldownIf: (s) => s.stacks('player', 'shadowy_insight') > 0,
      onCastStart: (s) => {
        if (s.stacks('player', 'shadowy_insight') > 0) s.data.si_cast = 1
      },
      onResolve: (s) => {
        if (s.data.si_cast) {
          s.removeAura('player', 'shadowy_insight')
          s.data.si_cast = 0
        }
        s.gain(6, 'mind_blast')
        s.damage('mind_blast', 0.78336)
        spawnApparitions(s, 1)
        if (s.rng('mind_devourer') < 0.08) s.applyAura('player', 'mind_devourer')
      },
    },
    {
      id: 'shadow_word_madness',
      name: 'Shadow Word: Madness',
      icon: 'inv12_ability_priest_powerwordmadness_eye',
      spellId: 335467,
      cost: 50,
      costMod: (s) => (s.stacks('player', 'mind_devourer') > 0 ? 0 : 50),
      onResolve: (s) => {
        const devoured = s.stacks('player', 'mind_devourer') > 0
        if (devoured) s.removeAura('player', 'mind_devourer')
        s.damage('shadow_word_madness', 2.275 * (devoured ? 1.2 : 1))
        s.applyAura('target', 'swm_dot')
        spawnApparitions(s, 1)
        // Ancient Madness: each SW:M in Voidform extends it 1.5s, 5 times
        const vf = s.aura('player', 'voidform')
        if (vf && (vf.data.ext ?? 0) < 5) {
          vf.data.ext = (vf.data.ext ?? 0) + 1
          s.extendAura('player', 'voidform', 1.5)
        }
      },
    },
    {
      id: 'mind_flay',
      name: 'Mind Flay',
      icon: 'spell_shadow_siphonmana',
      spellId: 15407,
      channel: {
        duration: 4.5,
        ticks: 6,
        hasted: true,
        onTick: (s) => {
          s.damage('mind_flay', 7.2072 / 6)
          s.gain(3, 'mind_flay')
        },
      },
      onResolve: () => {},
    },
    {
      id: 'mind_flay_insanity',
      name: 'Mind Flay: Insanity',
      icon: 'spell_fire_twilightflamebreath',
      spellId: 391403,
      usable: (s) => (s.stacks('player', 'mfi_charge') > 0 ? true : 'needs Mind Flay: Insanity (cast Halo)'),
      channel: {
        duration: 1.5,
        ticks: 2,
        hasted: true,
        onTick: (s) => {
          s.damage('mind_flay_insanity', 5.4236 / 2)
          s.gain(4, 'mfi')
        },
      },
      onCastStart: (s) => s.consumeStack('player', 'mfi_charge'),
      onResolve: () => {},
    },
    {
      id: 'shadow_word_death',
      name: 'Shadow Word: Death',
      icon: 'spell_shadow_demonicfortitude',
      spellId: 32379,
      cooldown: 10,
      onResolve: (s) => {
        s.gain(1, 'swd')
        s.damage('shadow_word_death', 0.85) // no execute: dummy never drops below 100%
      },
    },
    {
      id: 'tentacle_slam',
      name: 'Tentacle Slam',
      icon: 'inv12_ability_priest_tentacleslam',
      spellId: 1227280,
      cooldown: 12, // 15s, -3s from S2 2pc
      charges: 2,
      onResolve: (s) => {
        s.gain(6, 'tentacle_slam')
        s.damage('tentacle_slam', 0.687926 * 2) // S2 2pc: +100% damage
        s.applyAura('target', 'vt_dot')
        grantVoidVolley(s, 1) // S2 4pc: free Void Volley
        spawnApparitions(s, 4) // Apex R4: activates an Idol effect
      },
    },
    {
      id: 'void_volley',
      name: 'Void Volley',
      icon: 'inv12_ability_priest_voidvolley',
      spellId: 1242173,
      usable: (s) => (s.stacks('player', 'void_volley_charge') > 0 ? true : 'needs a Void Volley charge (Voidform / Tentacle Slam)'),
      onResolve: (s) => {
        s.consumeStack('player', 'void_volley_charge')
        s.gain(10, 'void_volley')
        s.damage('void_volley', VOID_VOLLEY_COEFF)
      },
    },
    {
      id: 'halo',
      name: 'Halo',
      icon: 'ability_priest_halo_shadow',
      spellId: 120644,
      castTime: 1.5,
      cooldown: 60,
      onResolve: (s) => {
        s.gain(5, 'halo')
        // Archon Power Surge: modeled as 3 halo waves, each granting MF:I
        for (const delay of [0, 5, 10]) {
          s.schedule(s.time + delay, () => {
            s.damage('halo', 1.442)
            s.applyAura('player', 'mfi_charge', { stacks: 1 })
          })
        }
      },
    },
    {
      id: 'voidform',
      name: 'Voidform',
      icon: 'spell_priest_void-blast',
      spellId: 228260,
      castTime: 1.5,
      cooldown: 120,
      onResolve: (s) => {
        s.applyAura('player', 'voidform')
        grantVoidVolley(s, 3)
        s.damage('void_volley', VOID_VOLLEY_COEFF) // fires a Void Volley on cast
      },
    },
    {
      id: 'power_infusion',
      name: 'Power Infusion',
      icon: 'spell_holy_powerinfusion',
      spellId: 10060,
      cooldown: 120,
      offGcd: true,
      onResolve: (s) => s.applyAura('player', 'power_infusion'),
    },
  ],

  actionBar: [
    'shadow_word_pain', 'vampiric_touch', 'mind_blast', 'shadow_word_madness',
    'mind_flay', 'mind_flay_insanity', 'tentacle_slam', 'void_volley',
    'halo', 'voidform', 'power_infusion', 'shadow_word_death',
  ],

  damageMult: (s) => (s.auraRemains('player', 'voidform') > 0 ? VOIDFORM_DMG : 1),
  hasteMod: (s) => (s.auraRemains('player', 'power_infusion') > 0 ? PI_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'mind_blast': return s.stacks('player', 'shadowy_insight') > 0
      case 'shadow_word_madness': return s.stacks('player', 'mind_devourer') > 0
      case 'mind_flay_insanity': return s.stacks('player', 'mfi_charge') > 0
      case 'void_volley': return s.stacks('player', 'void_volley_charge') > 0
      default: return false
    }
  },

  /**
   * Oracle — hand-translated from simc midnight `actions.main` + `actions.cds`
   * (single target, Archon), simplified to this kit. Comments cite the APL line.
   */
  policy: (s) => {
    const gcd = s.gcdLength()
    const vfUp = s.auraRemains('player', 'voidform') > 0
    const vfCd = s.cooldownRemains('voidform')
    const swpUp = s.auraRemains('target', 'swp_dot') > 0
    const vtUp = s.auraRemains('target', 'vt_dot') > 0
    const dotsUp = swpUp && vtUp
    const swmRemains = s.auraRemains('target', 'swm_dot')
    const canSpend = s.insanity >= 50 || s.stacks('player', 'mind_devourer') > 0

    // cds: halo → voidform → power_infusion, once dots are rolling
    if (dotsUp) {
      if (s.isUsable('halo') === true && s.timeToUsable('halo') === 0) return 'halo'
      if (s.isUsable('voidform') === true && s.timeToUsable('voidform') === 0) return 'voidform'
      if (vfUp && s.isUsable('power_infusion') === true) return 'power_infusion'
    }

    // shadow_word_madness: expiring | mind_devourer | deficit<=35 outside VF window | in VF
    if (canSpend && (
      swmRemains <= gcd
      || s.stacks('player', 'mind_devourer') > 0
      || (s.insanity >= 65 && vfCd > 25)
      || (vfUp && s.insanity >= 50)
    )) return 'shadow_word_madness'

    // void_volley while voidform is up (burst window)
    if (vfUp && s.isUsable('void_volley') === true) return 'void_volley'

    // tentacle_slam: VT refreshable or about to cap charges
    const vtRefreshable = s.auraRemains('target', 'vt_dot') < 21 * 0.3
    if ((vtRefreshable || s.chargesOf('tentacle_slam') === 2) && s.isUsable('tentacle_slam') === true) {
      return 'tentacle_slam'
    }

    // shadow_word_pain: Invoked Nightmare manual refresh in pandemic window
    if (s.auraRemains('target', 'swp_dot') < 16 * 0.3 && vtUp) return 'shadow_word_pain'
    if (!vtUp && s.isUsable('tentacle_slam') !== true) return 'vampiric_touch'
    if (!swpUp) return 'shadow_word_pain'

    // mind_blast unless a Mind Devourer proc is waiting to be spent
    if (s.isUsable('mind_blast') === true && s.timeToUsable('mind_blast') === 0
      && s.stacks('player', 'mind_devourer') === 0) return 'mind_blast'

    // mind_flay_insanity (Archon proc) while SW:M is ticking
    if (s.stacks('player', 'mfi_charge') > 0 && swmRemains > 0) return 'mind_flay_insanity'

    // vampiric_touch hard-cast if Tentacle Slam can't cover the refresh
    if (vtRefreshable && s.isUsable('tentacle_slam') !== true) return 'vampiric_touch'

    // leftover void_volley charges (4pc) before filler
    if (s.isUsable('void_volley') === true) return 'void_volley'

    // filler
    return 'mind_flay'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['mind_flay', 'shadow_word_death']
    const nukes = ['mind_blast', 'void_volley', 'mind_flay_insanity']
    const vtAppliers = ['tentacle_slam', 'vampiric_touch']
    const sets = [fillers, nukes, vtAppliers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
