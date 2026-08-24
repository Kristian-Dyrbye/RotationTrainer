import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Shadow Priest — patch 12.1.0 (Midnight, Season 2), Archon raid single-target
 * build with the Season 2 tier 2pc+4pc (Tentacle Slam CD -3s / +100% damage;
 * Slam grants a free Void Volley). Verified against live guides 2026-08-24:
 *   - Wowhead rotation guide: https://www.wowhead.com/guide/classes/priest/shadow/rotation-cooldowns-pve-dps
 *   - Method "Archon Raid" build + rotation: https://www.method.gg/guides/shadow-priest/playstyle-and-rotation
 *   - Icy Veins rotation: https://www.icy-veins.com/wow/shadow-priest-pve-dps-rotation-cooldowns-abilities
 *   - Maxroll raid guide: https://maxroll.gg/wow/class-guides/shadow-priest-raid-guide
 *
 * Talent assumptions (Method "Archon Raid" build): Invoked Nightmare (manual
 * SW:P upkeep; Icy Veins defaults to Misery here instead), Improved Voidform
 * (+2 Void Volley uses, extra Voidform damage — taken over Ancient Madness),
 * Mind's Eye (SW:Madness costs 45), Mind Devourer, Idol of Y'Shaarj,
 * Apex: Void Apparitions 4/4; Archon keystones Power Surge + Manifested Power
 * (each Halo wave grants Mind Flay: Insanity).
 *
 * Damage numbers are APPROX spell-power coefficients — sane relative
 * magnitudes only, not simc-verified. Simplifications: no Deathspeaker /
 * SW:Death execute (dummy sits at 100% HP), Thought Harvester dropped per
 * Icy Veins (Mind Blast back to one charge), Power Surge modeled as 3 halo
 * waves.
 */

const VOIDFORM_DMG = 1.25     // 20% base + 5% Improved Voidform (APPROX split)
const PI_HASTE = 0.2          // APPROX: 12.1 PI numbers unverified
const APPARITION_COEFF = 0.55 // APPROX: 12.1 apparition coefficient unpublished
const VOID_BOLT_COEFF = 1.5 * 1.35 // Apex Void Bolt, incl. 2026-03-31 +35% hotfix
const VOID_VOLLEY_COEFF = 4.0 // APPROX: tooltip ambiguous (95.44% per-bolt vs total)
const SWM_DOT_TOTAL = 0.5     // APPROX: "small DoT" — exact coefficient unpublished
const SWM_COST = 45           // 50 base, -5 from Mind's Eye
const VF_VOLLEY_USES = 5      // 3 base + 2 from Improved Voidform
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

/** is the Mind Flay button currently in its Insanity form? (proc up, or channeling it) */
function mfiActive(s: SimAPI): boolean {
  if (s.casting?.abilityId === 'mind_flay') return s.data.mfi_cast === 1
  return s.stacks('player', 'mfi_charge') > 0
}

/** is the Voidform button currently in its Void Volley form? */
function volleyReady(s: SimAPI): boolean {
  return s.stacks('player', 'void_volley_charge') > 0
}

export const shadowPriest: SpecConfig = {
  name: 'Shadow Priest',
  specId: 'priest-shadow',
  specIcon: 'spell_shadow_shadowform',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/priest/shadow/rotation-cooldowns-pve-dps',
    buildName: 'Archon Raid (Method default raid build)',
    heroTalent: 'Archon',
    // published verbatim on method.gg/guides/shadow-priest/talents (also mirrored by Icy Veins)
    talentString: 'CIQAAAAAAAAAAAAAAAAAAAAAAMMDDAAAAAAAAAAAAmZxMmZbmxMz2MGzw2MzYmZGbIzYxMNAzAMzmZY2MAkxYBAzMgxMzMmNmZbZAmBDA',
    retrieved: '2026-08-24',
  },
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
      cooldown: 9, // one charge: Thought Harvester not taken in 12.1 raid builds
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
      cost: SWM_COST, // Mind's Eye: -5 Insanity
      costMod: (s) => (s.stacks('player', 'mind_devourer') > 0 ? 0 : SWM_COST),
      onResolve: (s) => {
        const devoured = s.stacks('player', 'mind_devourer') > 0
        if (devoured) s.removeAura('player', 'mind_devourer')
        s.damage('shadow_word_madness', 2.275 * (devoured ? 1.2 : 1))
        s.applyAura('target', 'swm_dot')
        spawnApparitions(s, 1)
      },
    },
    {
      // One button, as in game: a Mind Flay: Insanity proc transforms it.
      id: 'mind_flay',
      name: 'Mind Flay',
      icon: 'spell_shadow_siphonmana',
      spellId: 15407,
      displayName: (s) => (mfiActive(s) ? 'Mind Flay: Insanity' : 'Mind Flay'),
      displayIcon: (s) => (mfiActive(s) ? 'spell_fire_twilightflamebreath' : 'spell_shadow_siphonmana'),
      displayStacks: (s) => s.stacks('player', 'mfi_charge'),
      onCastStart: (s) => {
        s.data.mfi_cast = s.stacks('player', 'mfi_charge') > 0 ? 1 : 0
        if (s.data.mfi_cast) s.consumeStack('player', 'mfi_charge')
      },
      channel: (s) => (s.data.mfi_cast
        ? {
            duration: 1.5,
            ticks: 2,
            hasted: true,
            onTick: (sim) => {
              sim.damage('Mind Flay: Insanity', 5.4236 / 2)
              sim.gain(4, 'mfi')
            },
          }
        : {
            duration: 4.5,
            ticks: 6,
            hasted: true,
            onTick: (sim) => {
              sim.damage('mind_flay', 7.2072 / 6)
              sim.gain(3, 'mind_flay')
            },
          }),
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
      // One button, as in game: while you hold Void Volley charges (from
      // Voidform or the S2 4pc), this button IS Void Volley.
      id: 'voidform',
      name: 'Voidform',
      icon: 'spell_priest_void-blast',
      spellId: 228260,
      castTime: 1.5,
      cooldown: 120,
      displayName: (s) => (volleyReady(s) ? 'Void Volley' : 'Voidform'),
      displayIcon: (s) => (volleyReady(s) ? 'inv12_ability_priest_voidvolley' : 'spell_priest_void-blast'),
      displayStacks: (s) => s.stacks('player', 'void_volley_charge'),
      noCooldownIf: (s) => volleyReady(s),
      castTimeMod: (s, base) => (volleyReady(s) ? 0 : base),
      onResolve: (s) => {
        if (volleyReady(s)) {
          s.consumeStack('player', 'void_volley_charge')
          s.gain(10, 'void_volley')
          s.damage('Void Volley', VOID_VOLLEY_COEFF)
        } else {
          s.applyAura('player', 'voidform')
          grantVoidVolley(s, VF_VOLLEY_USES) // 3 base + 2 Improved Voidform
          s.damage('Void Volley', VOID_VOLLEY_COEFF) // fires a Void Volley on cast
        }
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
    'mind_flay', 'tentacle_slam', 'halo', 'voidform',
    'power_infusion', 'shadow_word_death',
  ],

  damageMult: (s) => (s.auraRemains('player', 'voidform') > 0 ? VOIDFORM_DMG : 1),
  hasteMod: (s) => (s.auraRemains('player', 'power_infusion') > 0 ? PI_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'mind_blast': return s.stacks('player', 'shadowy_insight') > 0
      case 'shadow_word_madness': return s.stacks('player', 'mind_devourer') > 0
      case 'mind_flay': return s.stacks('player', 'mfi_charge') > 0
      case 'voidform': return s.stacks('player', 'void_volley_charge') > 0
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'shadow_word_pain', text: 'Keep up — refresh in the pandemic window (<4.8s left)', when: s => s.auraRemains('target', 'swp_dot') < 16 * 0.3 },
    { abilityId: 'tentacle_slam', text: 'Keep Vampiric Touch up (Slam applies it)', when: s => s.auraRemains('target', 'vt_dot') < 21 * 0.3 && s.isUsable('tentacle_slam') === true },
    { abilityId: 'vampiric_touch', text: 'Hard-cast only if Tentacle Slam has no charge', when: s => s.auraRemains('target', 'vt_dot') < 21 * 0.3 && s.isUsable('tentacle_slam') !== true },
    { abilityId: 'halo', text: 'On cooldown, once both DoTs are up', when: s => s.cooldownRemains('halo') === 0 },
    { abilityId: 'voidform', text: 'On cooldown (dump blocking Volley charges first)', when: s => s.cooldownRemains('voidform') === 0 },
    { abilityId: 'power_infusion', text: 'During Voidform', when: s => s.auraRemains('player', 'voidform') > 0 && s.cooldownRemains('power_infusion') === 0 },
    { abilityId: 'shadow_word_madness', text: 'Expiring, Mind Devourer proc, ≥65 Insanity (no Voidform soon), or in Voidform' },
    { abilityId: 'voidform', label: 'Void Volley', icon: 'inv12_ability_priest_voidvolley', text: 'Spend charges — in Voidform, and weave 4pc charges outside it', when: s => s.stacks('player', 'void_volley_charge') > 0 },
    { abilityId: 'tentacle_slam', text: 'Don’t sit at 2 charges (about to waste one)' },
    { abilityId: 'mind_blast', text: 'On cooldown (Shadowy Insight = free instant)' },
    { abilityId: 'mind_flay', text: 'Mind Flay: Insanity proc, while SW:M is ticking', when: s => s.stacks('player', 'mfi_charge') > 0 },
    { abilityId: 'mind_flay', text: 'Filler — always be casting' },
  ],

  /**
   * Oracle — the live-guide Archon single-target priority (Wowhead / Method /
   * Maxroll, 2026-08-24), simplified to this kit: DoTs → Halo → Voidform →
   * PI → SW:Madness → Void Volley → Slam charges → Mind Blast → MF:I → MF.
   */
  policy: (s) => {
    const gcd = s.gcdLength()
    const vfUp = s.auraRemains('player', 'voidform') > 0
    const vfCd = s.cooldownRemains('voidform')
    const swmRemains = s.auraRemains('target', 'swm_dot')
    const canSpend = s.insanity >= SWM_COST || s.stacks('player', 'mind_devourer') > 0

    // 1-2. DoTs first — apply before cooldown windows, refresh in pandemic.
    // Invoked Nightmare SW:P is manual; VT comes from Tentacle Slam, with a
    // hard-cast fallback when both Slam charges are down.
    if (s.auraRemains('target', 'swp_dot') < 16 * 0.3) return 'shadow_word_pain'
    if (s.auraRemains('target', 'vt_dot') < 21 * 0.3) {
      return s.isUsable('tentacle_slam') === true ? 'tentacle_slam' : 'vampiric_touch'
    }

    // 3-5. cds: halo → voidform → power_infusion.
    // (with volley charges up, pressing 'voidform' fires Void Volley — dumping
    // the charges is what unlocks the actual Voidform cast, so the same
    // button-priority covers both, exactly like in game)
    if (s.isUsable('halo') === true && s.timeToUsable('halo') === 0) return 'halo'
    if (vfCd === 0 && s.isUsable('voidform') === true) return 'voidform'
    if (vfUp && s.isUsable('power_infusion') === true) return 'power_infusion'

    // 6. shadow_word_madness: expiring | mind_devourer | near-cap outside VF window | in VF
    if (canSpend && (
      swmRemains <= gcd
      || s.stacks('player', 'mind_devourer') > 0
      || (s.insanity >= 65 && vfCd > 25)
      || (vfUp && s.insanity >= SWM_COST)
    )) return 'shadow_word_madness'

    // 7. Void Volley (the transformed Voidform button): top priority in
    // Voidform, and weave 4pc charges into the normal rotation outside it
    if (volleyReady(s)) return 'voidform'

    // 8. tentacle_slam: don't sit at 2 charges
    if (s.chargesOf('tentacle_slam') === 2 && s.isUsable('tentacle_slam') === true) {
      return 'tentacle_slam'
    }

    // 9. mind_blast on cooldown
    if (s.isUsable('mind_blast') === true && s.timeToUsable('mind_blast') === 0) return 'mind_blast'

    // 10. Mind Flay: Insanity (the transformed Mind Flay button) while SW:M is ticking
    if (s.stacks('player', 'mfi_charge') > 0 && swmRemains > 0) return 'mind_flay'

    // 11. filler (SW:Death would slot here on a sub-20% target — dummy never is)
    return 'mind_flay'
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const fillers = ['mind_flay', 'shadow_word_death']
    const nukes = ['mind_blast', 'voidform'] // 'voidform' is usually a Volley press here
    const vtAppliers = ['tentacle_slam', 'vampiric_touch']
    const sets = [fillers, nukes, vtAppliers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
