import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Shadow Priest — patch 12.1.0 (Midnight, Season 2), VOIDWEAVER raid
 * single-target build (alternate to the default Archon build in spec.ts),
 * with the Season 2 tier 2pc+4pc (Tentacle Slam CD -3s / +100% damage;
 * Slam grants a free Void Volley). Verified against live guides 2026-08-24:
 *   - Wowhead rotation guide: https://www.wowhead.com/guide/classes/priest/shadow/rotation-cooldowns-pve-dps
 *   - Method "Voidweaver Raid" build + rotation: https://www.method.gg/guides/shadow-priest/playstyle-and-rotation
 *     (priority list and opener quoted verbatim on that page; talent string
 *     from https://www.method.gg/guides/shadow-priest/talents)
 *   - Icy Veins builds ("strongly suggest starting out with Voidweaver"):
 *     https://www.icy-veins.com/wow/shadow-priest-pve-dps-spec-builds-talents
 *   - Icy Veins rotation: https://www.icy-veins.com/wow/shadow-priest-pve-dps-rotation-cooldowns-abilities
 *
 * Voidweaver kit (Method/Wowhead, 12.1): Void Torrent opens an Entropic Rift
 * that deals AoE damage over its duration; while the rift is active Mind
 * Blast becomes Void Blast (more damage, more Insanity). Each Shadow Word:
 * Madness cast empowers the rift's size and damage by 20%; Darkening Horizon
 * lets Void Blast extend the rift by 1s (max +5s). The build "focuses, and
 * shines, on small burst windows" — most damage lands inside rift windows.
 * No Halo / Power Surge / Mind Flay: Insanity here — those are Archon's.
 *
 * Talent assumptions (Method "Voidweaver Raid" build): Invoked Nightmare
 * (manual SW:P upkeep), Improved Voidform ("the better burst option,
 * especially in Voidweaver builds" — Method), Mind's Eye (SW:Madness costs
 * 45), Mind Devourer, Idol of Y'Shaarj, Apex: Void Apparitions 4/4;
 * Voidweaver keystones Entropic Rift / Void Blast / Darkening Horizon /
 * Voidheart / Collapsing Void.
 *
 * Damage numbers are APPROX spell-power coefficients — sane relative
 * magnitudes only, not simc-verified. APPROX/simplified:
 *   - Void Torrent total damage + 30 Insanity over the channel;
 *   - Void Blast coefficient, +8 Insanity, and Mind Blast at 2 charges with
 *     Void Torrent resetting them (matches Method's double-Void-Blast opener);
 *   - Entropic Rift base 8s, 1s tick, 20%-per-SW:M empowerment (uncapped),
 *     Collapsing Void burst on expiry, Voidheart +10% while the rift is open;
 *   - no Devour Matter SW:D absorb-shield rule and no sub-20% execute (the
 *     training dummy has no shield and never leaves 100% HP);
 *   - buff durations for Shadowy Insight / Mind Devourer / Volley charges
 *     unpublished, copied from the Archon model.
 */

const VOIDFORM_DMG = 1.25     // 20% base + 5% Improved Voidform (APPROX split)
const VOIDHEART_DMG = 1.10    // APPROX: +shadow damage while Entropic Rift is active
const PI_HASTE = 0.2          // APPROX: 12.1 PI numbers unverified
const APPARITION_COEFF = 0.55 // APPROX: 12.1 apparition coefficient unpublished
const VOID_BOLT_COEFF = 1.5 * 1.35 // Apex Void Bolt, incl. 2026-03-31 +35% hotfix
const VOID_VOLLEY_COEFF = 4.0 // APPROX: tooltip ambiguous (95.44% per-bolt vs total)
const SWM_DOT_TOTAL = 0.5     // APPROX: "small DoT" — exact coefficient unpublished
const SWM_COST = 45           // 50 base, -5 from Mind's Eye
const VF_VOLLEY_USES = 5      // 3 base + 2 from Improved Voidform
const VOID_BLAST_COEFF = 1.25   // APPROX: "does more damage" than Mind Blast (0.78336)
const VOID_TORRENT_TOTAL = 4.0  // APPROX total over the 3s channel
const RIFT_DURATION = 8         // APPROX base Entropic Rift lifetime
const RIFT_TICK_COEFF = 0.35    // APPROX per 1s rift tick
const RIFT_MAX_EXTENSION = 5    // Darkening Horizon: +1s per Void Blast, max 5s
const COLLAPSE_COEFF = 1.2      // APPROX Collapsing Void burst on rift expiry

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

/** is the Voidform button currently in its Void Volley form? */
function volleyReady(s: SimAPI): boolean {
  return s.stacks('player', 'void_volley_charge') > 0
}

/** is the Mind Blast button currently in its Void Blast form? */
function riftActive(s: SimAPI): boolean {
  return s.auraRemains('player', 'entropic_rift') > 0
}

export const shadowPriestVoidweaver: SpecConfig = {
  name: 'Shadow Priest',
  specId: 'priest-shadow',
  specIcon: 'spell_shadow_shadowform',
  buildId: 'voidweaver',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/priest/shadow/rotation-cooldowns-pve-dps',
    buildName: 'Voidweaver Raid (Method alternate raid build)',
    heroTalent: 'Voidweaver',
    // published verbatim on method.gg/guides/shadow-priest/talents ("Voidweaver Raid")
    talentString: 'CIQAAAAAAAAAAAAAAAAAAAAAAMMjZGAAAAAAAAAAAAMLmxMbzMMz2MzYG2mZGzMzYDZGLmpBYmZGAIAz2stAmNGAYwYmZGz2YGMzgZwA',
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
      // the Voidweaver signature: a zone the priest opens with Void Torrent.
      // Player-side aura (the rift belongs to you, not the target).
      id: 'entropic_rift',
      name: 'Entropic Rift',
      icon: 'inv_cosmicvoid_nova',
      duration: RIFT_DURATION,
      tick: {
        interval: 1,
        onTick: (s, aura) => {
          const empower = 1 + 0.2 * (aura.data.empower ?? 0)
          s.damage('Entropic Rift', RIFT_TICK_COEFF * empower)
        },
      },
      // Collapsing Void: the rift collapses when it expires, empowered 20%
      // per Shadow Word: Madness cast into it
      onExpire: (s, aura) => {
        const empower = 1 + 0.2 * (aura.data.empower ?? 0)
        s.damage('Collapsing Void', COLLAPSE_COEFF * empower)
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
      // One button, as in game: while Entropic Rift is open, Mind Blast IS
      // Void Blast (more damage, more Insanity, and it feeds the rift).
      id: 'mind_blast',
      name: 'Mind Blast',
      icon: 'spell_shadow_unholyfrenzy',
      spellId: 8092,
      castTime: 1.5,
      cooldown: 9,
      charges: 2, // APPROX build assumption: two charges so Void Torrent's reset yields the guide's double Void Blast
      displayName: (s) => (riftActive(s) ? 'Void Blast' : 'Mind Blast'),
      displayIcon: (s) => (riftActive(s) ? 'inv_cosmicvoid_missile' : 'spell_shadow_unholyfrenzy'),
      castTimeMod: (s, base) => (s.stacks('player', 'shadowy_insight') > 0 ? 0 : base),
      noCooldownIf: (s) => s.stacks('player', 'shadowy_insight') > 0,
      onCastStart: (s) => {
        if (s.stacks('player', 'shadowy_insight') > 0) s.data.si_cast = 1
        s.data.vb_cast = riftActive(s) ? 1 : 0 // snapshot the transform at cast start
      },
      onResolve: (s) => {
        if (s.data.si_cast) {
          s.removeAura('player', 'shadowy_insight')
          s.data.si_cast = 0
        }
        if (s.data.vb_cast) {
          s.data.vb_cast = 0
          s.gain(8, 'void_blast')
          s.damage('Void Blast', VOID_BLAST_COEFF)
          // Darkening Horizon: each Void Blast extends the rift 1s, max +5s
          const rift = s.aura('player', 'entropic_rift')
          if (rift && (rift.data.ext ?? 0) < RIFT_MAX_EXTENSION) {
            rift.data.ext = (rift.data.ext ?? 0) + 1
            s.extendAura('player', 'entropic_rift', 1)
          }
        } else {
          s.gain(6, 'mind_blast')
          s.damage('mind_blast', 0.78336)
        }
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
        // "Each Shadow Word: Madness you cast empowers your rift's size and
        // damage by 20%" (Wowhead 12.1 Voidweaver)
        const rift = s.aura('player', 'entropic_rift')
        if (rift) rift.data.empower = (rift.data.empower ?? 0) + 1
        spawnApparitions(s, 1)
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
        onTick: (sim) => {
          sim.damage('mind_flay', 7.2072 / 6)
          sim.gain(3, 'mind_flay')
        },
      },
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
        // no Devour Matter shield rule / execute: dummy has no absorb and
        // never drops below 100%
        s.damage('shadow_word_death', 0.85)
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
      // Voidweaver keystone: the channel that opens the Entropic Rift and
      // (Void Blast talent) resets Mind Blast so the window starts loaded.
      id: 'void_torrent',
      name: 'Void Torrent',
      icon: 'spell_priest_voidsear',
      spellId: 263165,
      cooldown: 45,
      onCastStart: (s) => {
        // the rift opens as the channel begins
        s.applyAura('player', 'entropic_rift')
        s.resetCooldown('mind_blast')
      },
      channel: {
        duration: 3,
        ticks: 6,
        hasted: true,
        onTick: (sim) => {
          sim.damage('Void Torrent', VOID_TORRENT_TOTAL / 6)
          sim.gain(5, 'void_torrent') // high Insanity gen "fuels your opening burst"
        },
      },
      onResolve: () => {},
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
    'mind_flay', 'tentacle_slam', 'void_torrent', 'voidform',
    'power_infusion', 'shadow_word_death',
  ],

  damageMult: (s) =>
    (s.auraRemains('player', 'voidform') > 0 ? VOIDFORM_DMG : 1)
    * (riftActive(s) ? VOIDHEART_DMG : 1),
  hasteMod: (s) => (s.auraRemains('player', 'power_infusion') > 0 ? PI_HASTE : 0),

  glows: (s, id) => {
    switch (id) {
      case 'mind_blast': return s.stacks('player', 'shadowy_insight') > 0 || riftActive(s)
      case 'shadow_word_madness': return s.stacks('player', 'mind_devourer') > 0
      case 'voidform': return s.stacks('player', 'void_volley_charge') > 0
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'shadow_word_pain', text: 'Keep up — refresh in the pandemic window (<4.8s left)', when: s => s.auraRemains('target', 'swp_dot') < 16 * 0.3 },
    { abilityId: 'tentacle_slam', text: 'Keep Vampiric Touch up (Slam applies it)', when: s => s.auraRemains('target', 'vt_dot') < 21 * 0.3 && s.isUsable('tentacle_slam') === true },
    { abilityId: 'vampiric_touch', text: 'Hard-cast only if Tentacle Slam has no charge', when: s => s.auraRemains('target', 'vt_dot') < 21 * 0.3 && s.isUsable('tentacle_slam') !== true },
    { abilityId: 'voidform', text: 'On cooldown (dump blocking Volley charges first)', when: s => s.cooldownRemains('voidform') === 0 },
    { abilityId: 'power_infusion', text: 'During Voidform', when: s => s.auraRemains('player', 'voidform') > 0 && s.cooldownRemains('power_infusion') === 0 },
    { abilityId: 'shadow_word_madness', text: 'High priority: expiring, Mind Devourer proc, ≥65 Insanity, or in Voidform — each cast empowers your Rift +20%' },
    { abilityId: 'voidform', label: 'Void Volley', icon: 'inv12_ability_priest_voidvolley', text: 'Spend charges — in Voidform, and weave 4pc charges outside it', when: s => s.stacks('player', 'void_volley_charge') > 0 },
    { abilityId: 'mind_blast', label: 'Void Blast', icon: 'inv_cosmicvoid_missile', text: 'While the Rift is open, if SW:Madness is ticking or the Rift is about to close', when: s => riftActive(s) },
    { abilityId: 'tentacle_slam', text: 'Don’t sit at 2 charges (about to waste one)' },
    { abilityId: 'void_torrent', text: 'Open the Entropic Rift — SW:Madness ticking first; never clip the channel', when: s => s.cooldownRemains('void_torrent') === 0 },
    { abilityId: 'mind_blast', text: 'On cooldown (Shadowy Insight = free instant)' },
    { abilityId: 'mind_flay', text: 'Filler — always be casting' },
  ],

  /**
   * Oracle — the live-guide Voidweaver single-target priority (Method /
   * Icy Veins / Wowhead, 2026-08-24), simplified to this kit: DoTs →
   * Voidform → PI → SW:Madness → Void Volley → Void Blast → Slam charges →
   * Void Torrent → Mind Blast → MF. (Method's SW:Death-on-absorb and
   * sub-20% execute rows are skipped: the dummy has no shield or execute.)
   */
  policy: (s) => {
    // never clip Void Torrent — the channel is the whole point of the window
    if (s.casting?.channel && s.casting.abilityId === 'void_torrent') return null

    const gcd = s.gcdLength()
    const vfUp = s.auraRemains('player', 'voidform') > 0
    const vfCd = s.cooldownRemains('voidform')
    const swmRemains = s.auraRemains('target', 'swm_dot')
    const riftRemains = s.auraRemains('player', 'entropic_rift')
    const canSpend = s.insanity >= SWM_COST || s.stacks('player', 'mind_devourer') > 0

    // 1-2. DoTs first — apply before cooldown windows, refresh in pandemic.
    // Invoked Nightmare SW:P is manual; VT comes from Tentacle Slam, with a
    // hard-cast fallback when both Slam charges are down.
    if (s.auraRemains('target', 'swp_dot') < 16 * 0.3) return 'shadow_word_pain'
    if (s.auraRemains('target', 'vt_dot') < 21 * 0.3) {
      return s.isUsable('tentacle_slam') === true ? 'tentacle_slam' : 'vampiric_touch'
    }

    // 3-4. cds: voidform → power_infusion. (with volley charges up, pressing
    // 'voidform' fires Void Volley — dumping the charges is what unlocks the
    // actual Voidform cast, so the same button-priority covers both)
    if (vfCd === 0 && s.isUsable('voidform') === true) return 'voidform'
    if (vfUp && s.isUsable('power_infusion') === true) return 'power_infusion'

    // 5. shadow_word_madness, high priority: expiring | mind_devourer |
    // near-cap outside the VF window | in VF — every cast empowers the rift
    if (canSpend && (
      swmRemains <= gcd
      || s.stacks('player', 'mind_devourer') > 0
      || (s.insanity >= 65 && vfCd > 25)
      || (vfUp && s.insanity >= SWM_COST)
    )) return 'shadow_word_madness'

    // 6. Void Volley (the transformed Voidform button): weave 4pc charges
    // into the normal rotation outside Voidform too
    if (volleyReady(s)) return 'voidform'

    // 7. Void Blast (the transformed Mind Blast button) while SW:M is
    // ticking or the rift is about to close
    if (
      riftRemains > 0
      && (swmRemains > 0 || riftRemains <= 1.5 / s.hasteMult() + gcd)
      && s.isUsable('mind_blast') === true && s.timeToUsable('mind_blast') === 0
    ) return 'mind_blast'

    // 8. tentacle_slam: don't sit at 2 charges
    if (s.chargesOf('tentacle_slam') === 2 && s.isUsable('tentacle_slam') === true) {
      return 'tentacle_slam'
    }

    // 9. void_torrent to open the Entropic Rift — SW:Madness ticking first
    // ("be sure to have Shadow Word: Madness active before casting")
    if (
      riftRemains === 0 && swmRemains > gcd
      && s.isUsable('void_torrent') === true && s.timeToUsable('void_torrent') === 0
    ) return 'void_torrent'

    // 10. mind_blast on cooldown (still Void Blast if a rift is open)
    if (s.isUsable('mind_blast') === true && s.timeToUsable('mind_blast') === 0) return 'mind_blast'

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
