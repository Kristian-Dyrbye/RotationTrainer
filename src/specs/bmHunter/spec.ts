import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Beast Mastery Hunter — patch 12.1.0 (Midnight, Season 2), Pack Leader raid
 * single-target build. Verified against live guides 2026-08-24:
 * - Wowhead: https://www.wowhead.com/guide/classes/hunter/beast-mastery/rotation-cooldowns-pve-dps
 * - Icy Veins: https://www.icy-veins.com/wow/beast-mastery-hunter-pve-dps-rotation-cooldowns-abilities
 * - Method: https://www.method.gg/guides/beast-mastery-hunter/playstyle-and-rotation
 *   (talent string from https://www.method.gg/guides/beast-mastery-hunter/talents,
 *   "Pack Leader Single Target / Raid (Recommended)")
 *
 * Midnight rework highlights (all corroborated by the guides above):
 * - Frenzy is REMOVED (replaced by a static +40% pet attack-speed talent,
 *   folded into the pet swing timer here).
 * - Barbed Shot's bleed is now a rolling, Ignite-style DoT that never clips
 *   (modeled with `rollover`). Barbed Shot and Kill Command both have 2 charges.
 * - Call of the Wild is removed. Bestial Wrath is the only DPS cooldown:
 *   flat 30s cooldown with The Beast Within, 15s duration, +20% damage.
 * - Pack Leader: Howl of the Pack Leader is a ~30s internal timer, sped up 1s
 *   per Cobra Shot / Kill Command cast; when ready, your next Kill Command
 *   summons a beast (Stampede). Every Bestial Wrath also readies a Howl.
 * - S2 tier: 2pc = Barbed Shot causes one extra Stomp at 50% effectiveness;
 *   4pc = each Stomp adds a Cobra Fang stack (max 4), buffing your next
 *   Cobra Shot per stack on single target.
 *
 * APPROX (not published / simplified): all damage coefficients (AP units),
 * pet swing timer, Wild Call-style charge refund on auto crits (kept from the
 * 12.0 model, unverified in 12.1), Barbed recharge modeled flat 12s
 * (hasted in game), Howl timer cadence, Cobra Fang bonus per stack (sources
 * quote 20-30%; 25% used), Stampede modeled as 4 scheduled beast hits.
 */

const AUTO_SHOT = 0.18        // APPROX ranged auto
const WILD_CALL_CHANCE = 0.30 // APPROX: per auto crit, refunds Barbed recharge
const PET_MELEE = 0.52        // APPROX pet swing
const PET_SWING = 2.0 / 1.4   // static +40% pet attack speed talent folded in
const KC_COEFF = 1.9
const KC_HOWL_MULT = 1.5      // APPROX: empowered (Howl) Kill Command bonus
const BARBED_DIRECT = 0.50
const BARBED_TICK = 0.40
const COBRA_COEFF = 1.0       // buffed into "an actual damaging ability" in 12.1
const COBRA_FANG_MULT = 0.25  // APPROX per stack (sources quote 20-30%)
const STOMP_COEFF = 0.35      // APPROX per Stomp
const STAMPEDE_HIT = 0.55     // APPROX: 4 hits over ~4s
const BW_MULT = 1.2           // Bestial Wrath: +20% damage for 15s
const HOWL_TIMER = 30         // base Howl of the Pack Leader cadence

/** Howl of the Pack Leader ready — the next Kill Command summons a beast */
function howlReady(s: SimAPI): boolean {
  return s.auraRemains('player', 'howl_ready') > 0
}

/** casting Cobra Shot / Kill Command speeds the Howl timer up by 1s */
function tickHowl(s: SimAPI, seconds: number) {
  s.data.howl = (s.data.howl ?? HOWL_TIMER) - seconds
  if (s.data.howl <= 0) {
    s.data.howl += HOWL_TIMER
    s.applyAura('player', 'howl_ready')
  }
}

/** Pack Leader beast summon (Stampede): 4 hits over ~4s */
function stampede(s: SimAPI) {
  for (let i = 0; i < 4; i++) {
    s.schedule(s.time + 0.6 + i * 1.1, () => s.damage('Stampede', STAMPEDE_HIT))
  }
}

export const bmHunter: SpecConfig = {
  name: 'Beast Mastery Hunter',
  specId: 'hunter-beastmastery',
  specIcon: 'ability_hunter_bestialdiscipline',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/hunter/beast-mastery/rotation-cooldowns-pve-dps',
    buildName: 'Pack Leader Single Target / Raid (Method build)',
    heroTalent: 'Pack Leader',
    talentString: 'C0PAAAAAAAAAAAAAAAAAAAAAAAMmxwCsAzwQDbAAYGGzs8AzwMmZMDzMGzMmZGzYGmZGzYGM0MAAAAgZAAAYmZmBYmNCDzCYbAYA',
    retrieved: '2026-08-24',
  },
  resourceName: 'Focus',
  resourceMax: 100,
  startingResource: 100,

  onCombatStart: (s) => {
    // ranged autos: hasted; crits can refund Barbed Shot recharge (APPROX)
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
    // Howl of the Pack Leader internal timer (first Howl arrives early)
    s.data.howl = 12
    const howlLoop = () => {
      tickHowl(s, 0.5)
      s.schedule(s.time + 0.5, howlLoop)
    }
    s.schedule(s.time + 0.5, howlLoop)
  },

  auras: [
    { id: 'bestial_wrath', name: 'Bestial Wrath', icon: 'ability_druid_ferociousbite', duration: 15 },
    {
      id: 'howl_ready',
      name: 'Howl of the Pack Leader',
      icon: 'inv_ability_packleaderhunter_vicioushunt',
      duration: 30,
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
        tickHowl(s, 1)
        const howled = howlReady(s)
        if (howled) {
          s.removeAura('player', 'howl_ready')
          stampede(s) // Pack Leader: the Howl-empowered KC summons a beast
        }
        s.damage('kill_command', KC_COEFF * (howled ? KC_HOWL_MULT : 1))
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
      id: 'cobra_shot',
      name: 'Cobra Shot',
      icon: 'ability_hunter_cobrashot',
      spellId: 193455,
      cost: 35,
      onResolve: (s) => {
        tickHowl(s, 1)
        const fang = s.stacks('player', 'cobra_fang')
        if (fang > 0) s.removeAura('player', 'cobra_fang')
        s.damage('cobra_shot', COBRA_COEFF * (1 + COBRA_FANG_MULT * fang))
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
        s.applyAura('player', 'howl_ready') // first KC after every BW summons a beast
      },
    },
  ],

  actionBar: [
    'kill_command', 'barbed_shot', 'cobra_shot', 'bestial_wrath',
  ],

  damageMult: (s) => (s.auraRemains('player', 'bestial_wrath') > 0 ? BW_MULT : 1),

  glows: (s, id) => {
    switch (id) {
      case 'kill_command': return howlReady(s)
      case 'barbed_shot': return s.chargesOf('barbed_shot') === 2
      case 'cobra_shot': return s.stacks('player', 'cobra_fang') >= 3
      default: return false
    }
  },

  // shown in the UI; rows mirror `policy` below, in the same order
  priorityList: [
    { abilityId: 'barbed_shot', text: 'Dump charges when Bestial Wrath is coming up (≤3s)', when: s => s.chargesOf('barbed_shot') > 0 && s.cooldownRemains('bestial_wrath') <= 3 },
    { abilityId: 'bestial_wrath', text: 'On cooldown, with Barbed Shot charges spent', when: s => s.cooldownRemains('bestial_wrath') === 0 },
    { abilityId: 'kill_command', text: 'When Howl of the Pack Leader is ready — summons a beast', when: s => howlReady(s) },
    { abilityId: 'cobra_shot', text: 'At 3+ stacks of Cobra Fang (S2 4pc)', when: s => s.stacks('player', 'cobra_fang') >= 3 },
    { abilityId: 'kill_command', text: 'Never sit at 2 charges', when: s => s.chargesOf('kill_command') === 2 },
    { abilityId: 'barbed_shot', text: 'On cooldown — the bleed rolls over, it never clips' },
    { abilityId: 'kill_command', text: 'Keep charges rolling with 30+ Focus' },
    { abilityId: 'cobra_shot', text: 'Filler above ~60 Focus (speeds the next Howl)' },
  ],

  /**
   * Oracle — hand-translated from the Wowhead/Icy Veins/Method 12.1 ST
   * priorities (Pack Leader): Barbed ahead of BW, BW on cooldown, Howl-
   * empowered KC, Cobra at 3+ Cobra Fang, then charges and filler.
   */
  policy: (s) => {
    const focus = s.insanity
    const barbed = s.chargesOf('barbed_shot')

    // dump Barbed charges as Bestial Wrath comes up, then BW itself
    if (barbed > 0 && s.cooldownRemains('bestial_wrath') <= 3) return 'barbed_shot'
    if (s.cooldownRemains('bestial_wrath') === 0) return 'bestial_wrath'

    // Howl of the Pack Leader: the empowered Kill Command outranks everything
    if (howlReady(s) && s.chargesOf('kill_command') > 0 && focus >= 30) return 'kill_command'

    // Cobra Shot at 3+ Cobra Fang stacks (S2 4pc payoff)
    if (s.stacks('player', 'cobra_fang') >= 3 && focus >= 35) return 'cobra_shot'

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
    const builders = ['barbed_shot', 'kill_command']
    const sets = [spenders, builders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
