import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Beast Mastery Hunter — patch 12.1.0 (Midnight, Season 2), Dark Ranger raid
 * single-target build (alternate to the default Pack Leader build in spec.ts).
 * Verified against live guides 2026-08-24:
 * - Wowhead: https://www.wowhead.com/guide/classes/hunter/beast-mastery/rotation-cooldowns-pve-dps
 * - Icy Veins: https://www.icy-veins.com/wow/beast-mastery-hunter-pve-dps-rotation-cooldowns-abilities
 * - Method: https://www.method.gg/guides/beast-mastery-hunter/playstyle-and-rotation
 *   (talent string from https://www.method.gg/guides/beast-mastery-hunter/talents,
 *   "Dark Ranger Single Target / Raid")
 *
 * Shared Midnight class facts (same as spec.ts): Frenzy and Call of the Wild
 * are removed, Bestial Wrath (flat 30s, 15s duration, +20% damage) is the
 * only cooldown, Barbed Shot's bleed is an Ignite-style rolling DoT, Barbed
 * Shot and Kill Command both hold 2 charges, S2 tier = extra Stomp per
 * Barbed Shot (2pc) feeding Cobra Fang stacks (4pc).
 *
 * Dark Ranger differences (Method priority list, corroborated by Icy Veins):
 * - Black Arrow is a rotational shot with a shadow DoT; during Withering
 *   Fire (the first 10 seconds of Bestial Wrath) it deals ~triple damage.
 * - Bestial Wrath summons a Dark Hound (Nature's Ally): while it is out,
 *   each Kill Command triggers a bonus Shadow Thrash.
 * - Bestial Wrath transforms into Wailing Arrow — one cast per cycle, used
 *   as Withering Fire is about to expire (within ~2 GCDs) to sneak one more
 *   Black Arrow into the window.
 * - Bleak Arrows: auto shots fire shadow arrows (cosmetic here; the Wild
 *   Call-style Barbed Shot recharge refund on auto crits is kept from the
 *   base model).
 * - Icy Veins: with the S2 4pc, Dark Ranger casts Cobra Shot ahead of
 *   Barbed Shot at 4 Cobra Fang stacks (Pack Leader goes at 3+).
 *
 * APPROX (not published / simplified): all damage coefficients (AP units),
 * Black Arrow cooldown (12s) and DoT (16s, snapshot Withering multiplier),
 * Withering Fire Black Arrow bonus (x3 per Method "around triple"), Dark
 * Hound as 4 scheduled bites over 8s, Shadow Thrash per-KC bonus, Wailing
 * Arrow extending Withering Fire 3s and resetting Black Arrow, pet swing
 * timer, Barbed recharge modeled flat 12s (hasted in game).
 */

const AUTO_SHOT = 0.18        // APPROX ranged auto (Bleak Arrows: shadow)
const WILD_CALL_CHANCE = 0.30 // APPROX: per auto crit, refunds Barbed recharge
const PET_MELEE = 0.52        // APPROX pet swing
const PET_SWING = 2.0 / 1.4   // static +40% pet attack speed talent folded in
const KC_COEFF = 1.9
const BARBED_DIRECT = 0.50
const BARBED_TICK = 0.40
const COBRA_COEFF = 1.0
const COBRA_FANG_MULT = 0.25  // APPROX per stack (sources quote 20-30%)
const STOMP_COEFF = 0.35      // APPROX per Stomp
const BW_MULT = 1.2           // Bestial Wrath: +20% damage for 15s
const BLACK_ARROW_HIT = 0.85  // APPROX
const BLACK_ARROW_TICK = 0.35 // APPROX shadow DoT tick
const WITHERING_MULT = 3.0    // "around triple its normal damage" (Method)
const SHADOW_THRASH = 0.55    // APPROX: bonus proc per KC while the Hound is out
const HOUND_BITE = 0.40       // APPROX: Dark Hound, 4 bites over 8s
const WAILING_COEFF = 2.2     // APPROX
const WAILING_EXTEND = 3      // APPROX: seconds of Withering Fire gained

function witheringUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'withering_fire') > 0
}

function houndOut(s: SimAPI): boolean {
  return s.auraRemains('player', 'natures_ally') > 0
}

export const bmDarkRanger: SpecConfig = {
  name: 'Beast Mastery Hunter',
  specId: 'hunter-beastmastery',
  specIcon: 'ability_hunter_bestialdiscipline',
  buildId: 'dark-ranger',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/hunter/beast-mastery/rotation-cooldowns-pve-dps',
    buildName: 'Dark Ranger Single Target / Raid (Method build)',
    heroTalent: 'Dark Ranger',
    talentString: 'C0PAAAAAAAAAAAAAAAAAAAAAAYzsNwAGwMsBZsAAgZMjZWMDzYmxMMzYYGzMjZMDzMjZMDGaGAAAAwMAAAMzMzgZGQYYWAbDAD',
    retrieved: '2026-08-24',
  },
  resourceName: 'Focus',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    // ranged autos (Bleak Arrows — shadow); crits can refund Barbed recharge
    const autoShot = () => {
      s.damage('Auto Shot', AUTO_SHOT)
      if (s.rng('auto_crit') < s.stats.critChance && s.rng('wild_call') < WILD_CALL_CHANCE) {
        s.reduceCooldown('barbed_shot', 6)
      }
      s.schedule(s.time + 2.2 * s.hasteMult(), autoShot)
    }
    s.schedule(s.time + 0.3, autoShot)
    // pet melee: hasted; static +40% attack speed folded into PET_SWING
    const swing = () => {
      s.damage('Pet Melee', PET_MELEE)
      s.schedule(s.time + PET_SWING * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.5, swing)
    // passive Focus regen: 5/s base, hasted, 0.5s granularity
    const regen = () => {
      s.gain(2.5 / s.hasteMult(), 'focus_regen')
      s.schedule(s.time + 0.5, regen)
    }
    s.schedule(s.time + 0.5, regen)
  },

  auras: [
    { id: 'bestial_wrath', name: 'Bestial Wrath', icon: 'ability_druid_ferociousbite', duration: 15 },
    {
      id: 'withering_fire',
      name: 'Withering Fire',
      icon: 'spell_shadow_scourgebuild',
      duration: 10, // the first 10 seconds of Bestial Wrath
    },
    {
      id: 'natures_ally',
      name: "Nature's Ally (Dark Hound)",
      icon: 'spell_shadow_darksummoning',
      duration: 8,
    },
    {
      id: 'cobra_fang',
      name: 'Cobra Fang',
      icon: 'inv_waepon_bow_zulgrub_d_01',
      duration: 30,
      maxStacks: 4, // S2 4pc: each Stomp adds a stack, up to 4
    },
    {
      id: 'barbed_bleed',
      name: 'Barbed Shot',
      icon: 'ability_hunter_barbedshot',
      duration: 8,
      rollover: true, // 12.1: Ignite-style rolling bleed — refreshes never clip
      debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s) => {
          s.damage('barbed_shot_bleed', BARBED_TICK)
          s.gain(5, 'barbed_shot') // 20 Focus over the bleed
        },
      },
    },
    {
      id: 'black_arrow_dot',
      name: 'Black Arrow',
      icon: 'ability_theblackarrow',
      duration: 16, // APPROX
      pandemic: true,
      debuff: true,
      tick: {
        interval: 2, hasted: true,
        onTick: (s, aura) => {
          // snapshot: a Black Arrow fired during Withering Fire keeps its bonus
          s.damage('black_arrow_dot', BLACK_ARROW_TICK * (aura.data.mult ?? 1))
        },
      },
    },
  ],

  abilities: [
    {
      id: 'kill_command',
      name: 'Kill Command',
      icon: 'ability_hunter_killcommand',
      spellId: 34026,
      cooldown: 7.5,
      charges: 2, // 12.1: Kill Command has 2 charges
      cost: 30,
      onResolve: (s) => {
        s.damage('kill_command', KC_COEFF)
        // while the Dark Hound is out, each Kill Command triggers Shadow Thrash
        if (houndOut(s)) s.damage('Shadow Thrash', SHADOW_THRASH)
      },
    },
    {
      id: 'barbed_shot',
      name: 'Barbed Shot',
      icon: 'ability_hunter_barbedshot',
      spellId: 217200,
      cooldown: 12, // APPROX: hasted recharge in game
      charges: 2,
      onResolve: (s) => {
        s.damage('barbed_shot', BARBED_DIRECT)
        s.applyAura('target', 'barbed_bleed')
        // pets Stomp on Barbed Shot; S2 2pc adds an extra Stomp at 50%
        s.damage('Stomp', STOMP_COEFF)
        s.damage('Stomp', STOMP_COEFF * 0.5)
        // S2 4pc: each Stomp adds a Cobra Fang stack (2 Stomps per Barbed)
        s.applyAura('player', 'cobra_fang', { stacks: 1 })
        s.applyAura('player', 'cobra_fang', { stacks: 1 })
      },
    },
    {
      id: 'black_arrow',
      name: 'Black Arrow',
      icon: 'ability_theblackarrow',
      spellId: 466930,
      cooldown: 12, // APPROX
      onResolve: (s) => {
        const mult = witheringUp(s) ? WITHERING_MULT : 1
        s.damage('black_arrow', BLACK_ARROW_HIT * mult)
        const dot = s.applyAura('target', 'black_arrow_dot')
        dot.data.mult = mult
      },
    },
    {
      id: 'cobra_shot',
      name: 'Cobra Shot',
      icon: 'ability_hunter_cobrashot',
      spellId: 193455,
      cost: 35,
      onResolve: (s) => {
        const fang = s.stacks('player', 'cobra_fang')
        if (fang > 0) s.removeAura('player', 'cobra_fang')
        s.damage('cobra_shot', COBRA_COEFF * (1 + COBRA_FANG_MULT * fang))
      },
    },
    {
      id: 'wailing_arrow',
      name: 'Wailing Arrow',
      icon: 'inv_quiver_1h_mawraid_d_01',
      spellId: 392060,
      cooldown: 30, // one per Bestial Wrath cycle (BW transforms into it)
      usable: (s) => (witheringUp(s) ? true : 'Bestial Wrath transforms during Withering Fire'),
      onResolve: (s) => {
        s.damage('wailing_arrow', WAILING_COEFF)
        // sneak one more Black Arrow into the window (APPROX modeling)
        s.extendAura('player', 'withering_fire', WAILING_EXTEND)
        s.resetCooldown('black_arrow')
      },
    },
    {
      id: 'bestial_wrath',
      name: 'Bestial Wrath',
      icon: 'ability_druid_ferociousbite',
      spellId: 19574,
      cooldown: 30, // flat 30s with The Beast Within
      onResolve: (s) => {
        s.applyAura('player', 'bestial_wrath')
        s.applyAura('player', 'withering_fire') // first 10s of the window
        s.applyAura('player', 'natures_ally')   // summons a Dark Hound
        for (let i = 0; i < 4; i++) {
          s.schedule(s.time + 0.8 + i * 2, () => s.damage('Dark Hound', HOUND_BITE))
        }
      },
    },
  ],

  actionBar: [
    'kill_command', 'barbed_shot', 'black_arrow', 'cobra_shot',
    'wailing_arrow', 'bestial_wrath',
  ],

  damageMult: (s) => (s.auraRemains('player', 'bestial_wrath') > 0 ? BW_MULT : 1),

  glows: (s, id) => {
    switch (id) {
      case 'black_arrow': return witheringUp(s) && s.cooldownRemains('black_arrow') === 0
      case 'kill_command': return houndOut(s)
      case 'wailing_arrow': return witheringUp(s) && s.cooldownRemains('wailing_arrow') === 0
      case 'barbed_shot': return s.chargesOf('barbed_shot') === 2
      case 'cobra_shot': return s.stacks('player', 'cobra_fang') >= 4
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'barbed_shot', text: 'Dump charges when Bestial Wrath is coming up (≤3s)', when: s => s.chargesOf('barbed_shot') > 0 && s.cooldownRemains('bestial_wrath') <= 3 },
    { abilityId: 'bestial_wrath', text: 'On cooldown — opens Withering Fire and summons a Dark Hound', when: s => s.cooldownRemains('bestial_wrath') === 0 },
    { abilityId: 'kill_command', text: 'During Withering Fire only to avoid capping 2 charges', when: s => witheringUp(s) && s.chargesOf('kill_command') === 2 },
    { abilityId: 'black_arrow', text: 'During Withering Fire — around triple damage', when: s => witheringUp(s) && s.cooldownRemains('black_arrow') === 0 },
    { abilityId: 'kill_command', text: 'While the Dark Hound is out (each cast Shadow Thrashes)', when: s => houndOut(s) },
    { abilityId: 'wailing_arrow', text: 'As Withering Fire is about to expire (≤2 GCDs) — sneaks in one more Black Arrow', when: s => witheringUp(s) && s.auraRemains('player', 'withering_fire') <= 3 && s.cooldownRemains('wailing_arrow') === 0 },
    { abilityId: 'cobra_shot', text: 'At 4 stacks of Cobra Fang, ahead of Barbed Shot (S2 4pc)', when: s => s.stacks('player', 'cobra_fang') >= 4 },
    { abilityId: 'black_arrow', text: 'On cooldown — keep the shadow DoT rolling' },
    { abilityId: 'kill_command', text: 'Never sit at 2 charges', when: s => s.chargesOf('kill_command') === 2 },
    { abilityId: 'barbed_shot', text: 'On cooldown — the bleed rolls over, it never clips' },
    { abilityId: 'kill_command', text: 'Keep charges rolling with 30+ Focus' },
    { abilityId: 'cobra_shot', text: 'Filler above ~60 Focus' },
  ],

  /**
   * Oracle — hand-translated from the Method 12.1 Dark Ranger ST list
   * (Barbed ahead of BW > BW > Black Arrow during Withering Fire without
   * capping Kill Command > KC with Nature's Ally > Wailing Arrow as
   * Withering expires > Cobra at max Cobra Fang > Black Arrow > Barbed >
   * Cobra filler), corroborated by Icy Veins.
   */
  policy: (s) => {
    const focus = s.insanity
    const barbed = s.chargesOf('barbed_shot')
    const withering = witheringUp(s)

    // dump Barbed charges as Bestial Wrath comes up, then BW itself
    if (barbed > 0 && s.cooldownRemains('bestial_wrath') <= 3) return 'barbed_shot'
    if (s.cooldownRemains('bestial_wrath') === 0) return 'bestial_wrath'

    // Withering Fire: Black Arrow triples, but never cap Kill Command
    if (withering && s.chargesOf('kill_command') === 2 && focus >= 30) return 'kill_command'
    if (withering && s.cooldownRemains('black_arrow') === 0) return 'black_arrow'

    // Kill Command while the Dark Hound is out (bonus Shadow Thrash)
    if (houndOut(s) && s.chargesOf('kill_command') > 0 && focus >= 30) return 'kill_command'

    // Wailing Arrow as Withering Fire is about to run out (≤2 GCDs)
    if (withering && s.auraRemains('player', 'withering_fire') <= 2 * s.gcdLength()
      && s.cooldownRemains('wailing_arrow') === 0) {
      return 'wailing_arrow'
    }

    // Cobra Shot at 4 Cobra Fang stacks, ahead of Barbed Shot (S2 4pc)
    if (s.stacks('player', 'cobra_fang') >= 4 && focus >= 35) return 'cobra_shot'

    // Black Arrow on cooldown — keep the DoT rolling
    if (s.cooldownRemains('black_arrow') === 0) return 'black_arrow'

    // never cap Kill Command charges
    if (s.chargesOf('kill_command') === 2 && focus >= 30) return 'kill_command'

    // Barbed Shot on cooldown — the rolling bleed never clips
    if (barbed > 0) return 'barbed_shot'

    // Kill Command with a charge and Focus
    if (s.chargesOf('kill_command') > 0 && focus >= 30) return 'kill_command'

    // Cobra Shot filler; pool below ~60 so Kill Command is never Focus-starved
    if (focus >= 60) return 'cobra_shot'
    return null // pool Focus
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const spenders = ['kill_command', 'cobra_shot']
    const builders = ['barbed_shot', 'kill_command', 'black_arrow']
    const sets = [spenders, builders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
