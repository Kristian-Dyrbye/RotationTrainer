import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Enhancement Shaman — patch 12.1.0 (Midnight, Season 2), Totemic raid ST
 * build with the S2 "Ophidian Oracle's Prophecy" tier 2pc+4pc. Alternate build
 * to the default Stormbringer spec.ts.
 * Sources (verified 2026-08-24):
 *  - Method ST priority (quoted verbatim): method.gg/guides/enhancement-shaman/playstyle-and-rotation
 *    1. Voltaic Blaze 2. Lava Lash in Hot Hand 3. Crash Lightning
 *    4. Primordial Storm at 10 Maelstrom Weapon 5. Stormstrike in Doom Winds
 *    6. Lightning Bolt at 10 MSW 7. Lava Lash 8. Stormstrike 9. Lightning Bolt at 5+ MSW
 *  - Icy Veins rotation (Totemic toggle): icy-veins.com/wow/enhancement-shaman-pve-dps-rotation-cooldowns-abilities
 *    Surging Totem ~every minute; Sundering first for Surging Elements + the
 *    Earth Mote, Lava Lash starts Hot Hand, Doom Winds extends the window via
 *    Thorim's Invocation; Lava Lash every other GCD with spenders between
 *    (Elemental Tempo); spend at 10 or to extend Hot Hand (Totemic Momentum);
 *    Primordial Storm is a combo follow-up unlocked by casting Sundering
 *    (Fire ➜ Frost ➜ Lightning strikes ➜ empowered Maelstrom Weapon spender).
 * No Totemic raid-ST talent import string is published verbatim (Icy Veins
 * only publishes a Delves Totemic code; Method only Stormbringer) — omitted.
 *
 * Resource model: identical to spec.ts — Maelstrom Weapon (max 10) built by
 * hasted dual-wield autos and strikes, spent on instant Lightning Bolt /
 * Primordial Storm. Mana is not modeled.
 * Talent assumptions (Method/Icy Veins Totemic raid): Voltaic Blaze, Crash
 * Lightning, Doom Winds + Thorim's Invocation (strikes discharge a spender in
 * the window; +2s duration), Surging Totem + Whirling Elements (Earth doubles
 * next Sundering, Air launches a Surging Bolt with the next spender, Fire
 * guarantees Hot Hand on the next Lava Lash), Surging Elements (+15% haste,
 * +5 MSW on Sundering), Totemic Momentum (spending extends Hot Hand), Hot
 * Hand (Lava Lash CD collapses to ~2 GCDs), Elemental Tempo (0.3s strike CDR
 * per stack spent), Apex: Storm Unleashed 4/4 (folded into coefficients).
 * S2 tier: 2pc Voltaic Blaze erupts a Fire Nova on the target every 2s for 6s
 * (200% to primary folded in); 4pc each Fire Nova pulse reduces Crash
 * Lightning's cooldown by 2s and charges it +8%, stacking to 5.
 * APPROX-flagged: proc rates, auto cadence, Surging Totem cooldown/duration/
 * tick, mote and Primordial window durations, per-stack spender scaling,
 * Totemic Momentum extension rate, coefficients. Damage in AP units.
 */

const AUTO_COEFF = 0.30
const SWING_TIME = 1.4          // APPROX combined DW stream
const WF_COEFF = 0.55
const WF_CHANCE = 0.20
const WF_DOOM_CHANCE = 0.60     // during Doom Winds
const HOT_HAND_CHANCE = 0.05    // APPROX per swing
const SS_COEFF = 1.4            // both hands
const LL_COEFF = 1.05
const HOT_HAND_MULT = 1.4
const LB_PER_MSW = 0.19         // APPROX per stack spent
const VB_DIRECT = 1.2
const FIRE_NOVA = 0.55          // APPROX per 2pc pulse, 200%-to-primary folded in
const CRASH_COEFF = 1.15
const CRASH_PER_STACK = 0.08    // 4pc: +8% per Fire Nova charge, max 5
const FS_TICK = 0.30
const TEMPO_CDR = 0.3           // Elemental Tempo: strike CDR per stack spent
const MOMENTUM_PER_MSW = 0.3    // APPROX Totemic Momentum: Hot Hand extension per stack spent
const TOTEM_TICK = 0.5          // APPROX Surging Totem tremor pulse
const SUNDERING_COEFF = 2.3     // APPROX
const SURGING_BOLT = 1.0        // APPROX Whirling Air payload
const PRIMORDIAL_STRIKE = 0.9   // APPROX each of Fire/Frost/Lightning strikes
const PRIMORDIAL_SPENDER_MULT = 1.5 // empowered closing spender vs plain bolt
const HOT_HAND_LL_CDR = 6       // 9s base − 6s = ~2 GCDs during Hot Hand

function hotHandUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'hot_hand') > 0
}

function doomUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'doom_winds') > 0
}

/**
 * Spend all Maelstrom Weapon (max 10): Elemental Tempo CDR to the strikes,
 * Totemic Momentum extends Hot Hand, Whirling Air launches its Surging Bolt.
 * Returns the number of stacks spent.
 */
function dischargeSpend(s: SimAPI): number {
  const n = Math.min(10, Math.floor(s.insanity))
  if (n <= 0) return 0
  s.spend(n)
  for (const id of ['stormstrike', 'lava_lash']) {
    s.reduceCooldown(id, TEMPO_CDR * n)
  }
  if (hotHandUp(s)) s.extendAura('player', 'hot_hand', MOMENTUM_PER_MSW * n)
  if (s.auraRemains('player', 'whirling_air') > 0) {
    s.removeAura('player', 'whirling_air')
    s.damage('Surging Bolt', SURGING_BOLT)
  }
  return n
}

/** Thorim's Invocation: strikes during Doom Winds discharge a full spender */
function thorimDischarge(s: SimAPI) {
  if (!doomUp(s)) return
  const n = dischargeSpend(s)
  if (n > 0) s.damage("Thorim's Invocation", LB_PER_MSW * n)
}

export const enhancementTotemic: SpecConfig = {
  name: 'Enhancement Shaman',
  specId: 'shaman-enhancement',
  specIcon: 'spell_shaman_improvedstormstrike',
  buildId: 'totemic',
  resourceName: 'Maelstrom Weapon',
  resourceMax: 10,
  startingResource: 0,

  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/shaman/enhancement/rotation-cooldowns-pve-dps',
    buildName: 'Totemic Raid ST',
    heroTalent: 'Totemic',
    // no Totemic raid-ST import string is published verbatim (Icy Veins only
    // has a Delves Totemic code; Method only Stormbringer) — intentionally omitted
    retrieved: '2026-08-24',
  },

  onCombatStart: (s) => {
    // dual-wield autos: hasted; each swing builds Maelstrom and rolls
    // Windfury (tripled-up under Doom Winds) and Hot Hand
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      s.gain(1, 'auto_msw')
      const wfChance = doomUp(s) ? WF_DOOM_CHANCE : WF_CHANCE
      if (s.rng('windfury') < wfChance) s.damage('Windfury', WF_COEFF)
      if (s.rng('hot_hand') < HOT_HAND_CHANCE) s.applyAura('player', 'hot_hand')
      s.schedule(s.time + SWING_TIME * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'hot_hand', name: 'Hot Hand', icon: 'spell_fire_playingwithfire', duration: 8 },
    {
      id: 'doom_winds', name: 'Doom Winds', icon: 'spell_nature_cyclone', duration: 10, // 8s + Thorim's Invocation +2s
      // Static Accumulation: the window floods Maelstrom Weapon (~2/s)
      tick: { interval: 1, hasted: false, onTick: s => s.gain(2, 'static_accumulation') },
    },
    {
      // Surging Totem: ~1-minute burst anchor, pulsing tremor damage
      id: 'surging_totem', name: 'Surging Totem', icon: 'inv_ability_totemicshaman_surgingtotem', duration: 24,
      tick: { interval: 3, hasted: false, onTick: s => s.damage('Surging Totem', TOTEM_TICK) },
    },
    // Whirling Elements motes granted by Surging Totem
    { id: 'whirling_earth', name: 'Whirling Earth', icon: 'spell_shaman_unleashweapon_earth', duration: 20 },
    { id: 'whirling_air', name: 'Whirling Air', icon: 'spell_shaman_unleashweapon_wind', duration: 20 },
    { id: 'whirling_fire', name: 'Whirling Fire', icon: 'spell_shaman_unleashweapon_flame', duration: 20 },
    // Surging Elements: Sundering grants 15% haste for 12s
    { id: 'surging_elements', name: 'Surging Elements', icon: 'spell_nature_shamanrage', duration: 12 },
    // Sundering unlocks the Primordial Storm combo follow-up
    { id: 'primordial_storm_ready', name: 'Primordial Storm', icon: 'spell_shaman_primalstrike', duration: 20 }, // APPROX window
    // S2 4pc: Fire Nova pulses charge the next Crash Lightning, +8% each
    { id: 'charged_crash', name: 'Charged Crash Lightning', icon: 'spell_shaman_crashlightning', duration: 30, maxStacks: 5 },
    {
      id: 'flame_shock', name: 'Flame Shock', icon: 'spell_fire_flameshock', duration: 18, pandemic: true, debuff: true,
      tick: { interval: 2, hasted: true, onTick: s => s.damage('flame_shock', FS_TICK) },
    },
  ],

  // Surging Elements haste windows speed swings, GCDs and Flame Shock ticks
  hasteMod: (s) => (s.auraRemains('player', 'surging_elements') > 0 ? 0.15 : 0),

  abilities: [
    {
      id: 'voltaic_blaze',
      name: 'Voltaic Blaze',
      icon: 'inv_10_dungeonjewelry_primalist_trinket_1ragingelement_fire',
      spellId: 470057,
      cooldown: 15, // APPROX
      onResolve: (s) => {
        s.damage('voltaic_blaze', VB_DIRECT, { tags: ['fire'] })
        s.applyAura('target', 'flame_shock')
        s.gain(1, 'voltaic_blaze')
        // S2 2pc: the target erupts in a Fire Nova every 2s for 6s;
        // 4pc: each pulse hastens and charges Crash Lightning
        for (const delay of [2, 4, 6]) {
          s.schedule(s.time + delay, () => {
            s.damage('Fire Nova', FIRE_NOVA, { tags: ['fire'] })
            s.reduceCooldown('crash_lightning', 2)
            s.applyAura('player', 'charged_crash', { stacks: 1 })
          })
        }
      },
    },
    {
      id: 'surging_totem',
      name: 'Surging Totem',
      icon: 'inv_ability_totemicshaman_surgingtotem',
      spellId: 444995,
      cooldown: 60, // APPROX: guides say "as close to every minute as possible"
      onResolve: (s) => {
        s.applyAura('player', 'surging_totem')
        // Whirling Elements: one mote of each element to consume
        s.applyAura('player', 'whirling_earth')
        s.applyAura('player', 'whirling_air')
        s.applyAura('player', 'whirling_fire')
      },
    },
    {
      id: 'sundering',
      name: 'Sundering',
      icon: 'ability_rhyolith_lavapool',
      spellId: 197214,
      cooldown: 30,
      onResolve: (s) => {
        let mult = 1
        if (s.auraRemains('player', 'whirling_earth') > 0) {
          s.removeAura('player', 'whirling_earth') // Whirling Earth: doubled Sundering
          mult = 2
        }
        s.damage('sundering', SUNDERING_COEFF * mult, { tags: ['fire'] })
        // Surging Elements: +15% haste and 5 Maelstrom Weapon
        s.applyAura('player', 'surging_elements')
        s.gain(5, 'surging_elements')
        // unlocks the Primordial Storm combo follow-up
        s.applyAura('player', 'primordial_storm_ready')
      },
    },
    {
      id: 'primordial_storm',
      name: 'Primordial Storm',
      icon: 'spell_shaman_primalstrike',
      spellId: 1218090,
      usable: (s) => {
        if (s.auraRemains('player', 'primordial_storm_ready') <= 0) return 'requires Sundering first'
        if (s.insanity < 5) return 'needs 5+ Maelstrom Weapon'
        return true
      },
      onResolve: (s) => {
        s.removeAura('player', 'primordial_storm_ready')
        const n = dischargeSpend(s)
        // fixed sequence: Fire ➜ Frost ➜ Lightning strikes, then an empowered spender
        s.damage('Primordial Fire', PRIMORDIAL_STRIKE, { tags: ['fire'] })
        s.schedule(s.time + 0.4, () => s.damage('Primordial Frost', PRIMORDIAL_STRIKE))
        s.schedule(s.time + 0.8, () => s.damage('Primordial Lightning', PRIMORDIAL_STRIKE))
        s.schedule(s.time + 1.2, () => s.damage('Primordial Storm', LB_PER_MSW * n * PRIMORDIAL_SPENDER_MULT))
      },
    },
    {
      id: 'crash_lightning',
      name: 'Crash Lightning',
      icon: 'spell_shaman_crashlightning',
      spellId: 187874,
      cooldown: 12, // APPROX; Fire Nova (4pc) pulls it down hard
      onResolve: (s) => {
        const stacks = s.stacks('player', 'charged_crash')
        if (stacks > 0) s.removeAura('player', 'charged_crash')
        s.damage('crash_lightning', CRASH_COEFF * (1 + CRASH_PER_STACK * stacks))
        s.gain(1, 'crash_lightning')
        thorimDischarge(s)
      },
    },
    {
      id: 'stormstrike',
      name: 'Stormstrike',
      icon: 'ability_shaman_stormstrike',
      spellId: 17364,
      cooldown: 7.5,
      onResolve: (s) => {
        s.damage('stormstrike', SS_COEFF)
        s.gain(2, 'stormstrike')
        thorimDischarge(s)
      },
    },
    {
      id: 'lava_lash',
      name: 'Lava Lash',
      icon: 'ability_shaman_lavalash',
      spellId: 60103,
      cooldown: 9,
      onResolve: (s) => {
        // Whirling Fire: the next Lava Lash guarantees Hot Hand
        if (s.auraRemains('player', 'whirling_fire') > 0) {
          s.removeAura('player', 'whirling_fire')
          s.applyAura('player', 'hot_hand')
        }
        const hot = hotHandUp(s)
        s.damage('lava_lash', LL_COEFF * (hot ? HOT_HAND_MULT : 1), { tags: ['fire'] })
        s.gain(1, 'lava_lash')
        // Totemic Hot Hand: Lava Lash comes back every ~2 GCDs
        if (hot) s.reduceCooldown('lava_lash', HOT_HAND_LL_CDR)
      },
    },
    {
      id: 'lightning_bolt',
      name: 'Lightning Bolt',
      icon: 'spell_nature_lightning',
      spellId: 188196,
      usable: (s) => (s.insanity >= 5 ? true : 'needs 5+ Maelstrom Weapon'),
      onResolve: (s) => {
        const n = dischargeSpend(s)
        s.damage('lightning_bolt', LB_PER_MSW * n)
      },
    },
    {
      id: 'doom_winds',
      name: 'Doom Winds',
      icon: 'spell_nature_cyclone',
      spellId: 384352,
      cooldown: 60,
      onResolve: (s) => s.applyAura('player', 'doom_winds'),
    },
  ],

  actionBar: [
    'stormstrike', 'crash_lightning', 'lava_lash', 'lightning_bolt', 'primordial_storm',
    'voltaic_blaze', 'sundering', 'surging_totem', 'doom_winds',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'lava_lash': return hotHandUp(s) || s.auraRemains('player', 'whirling_fire') > 0
      case 'sundering': return s.auraRemains('player', 'whirling_earth') > 0
      case 'primordial_storm': return s.auraRemains('player', 'primordial_storm_ready') > 0 && s.insanity >= 10
      case 'crash_lightning': return s.stacks('player', 'charged_crash') >= 5
      case 'stormstrike': return doomUp(s)
      case 'lightning_bolt': return s.insanity >= 10
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'voltaic_blaze', text: 'Apply Flame Shock — top priority with the 2pc', when: s => s.auraRemains('target', 'flame_shock') === 0 && s.isUsable('voltaic_blaze') === true },
    { abilityId: 'surging_totem', text: 'Every minute — plants the totem and grants all three Whirling Elements motes', when: s => s.isUsable('surging_totem') === true },
    { abilityId: 'sundering', text: 'Right after Surging Totem (Whirling Earth doubles it); unlocks Primordial Storm', when: s => s.isUsable('sundering') === true },
    { abilityId: 'lava_lash', text: 'In Hot Hand / with Whirling Fire — every other GCD, weave a spender between', when: s => (hotHandUp(s) || s.auraRemains('player', 'whirling_fire') > 0) && s.isUsable('lava_lash') === true },
    { abilityId: 'voltaic_blaze', text: 'On cooldown — 2pc Fire Nova eruption', when: s => s.isUsable('voltaic_blaze') === true },
    { abilityId: 'doom_winds', text: 'With the totem down — Windfury window; strikes discharge spenders (Thorim’s Invocation)', when: s => s.isUsable('doom_winds') === true },
    { abilityId: 'crash_lightning', text: 'Whenever available — 4pc Fire Nova charges make it hit hard', when: s => s.isUsable('crash_lightning') === true },
    { abilityId: 'primordial_storm', text: 'At 10 Maelstrom Weapon — Fire ➜ Frost ➜ Lightning + empowered spender', when: s => s.auraRemains('player', 'primordial_storm_ready') > 0 && s.insanity >= 10 },
    { abilityId: 'stormstrike', text: 'In Doom Winds — each strike discharges your Maelstrom Weapon', when: s => doomUp(s) && s.isUsable('stormstrike') === true },
    { abilityId: 'lightning_bolt', text: 'At 10 Maelstrom Weapon — spending extends Hot Hand (Totemic Momentum)', when: s => s.insanity >= 10 },
    { abilityId: 'lava_lash', text: 'Main strike — cast as often as possible' },
    { abilityId: 'stormstrike', text: 'Backup filler' },
    { abilityId: 'lightning_bolt', text: 'At 5+ Maelstrom Weapon when everything else is down' },
  ],

  policy: (s) => {
    const msw = s.insanity

    if (s.auraRemains('target', 'flame_shock') === 0 && s.isUsable('voltaic_blaze') === true) return 'voltaic_blaze'
    if (s.isUsable('surging_totem') === true) return 'surging_totem'
    if (s.isUsable('sundering') === true) return 'sundering'
    if ((hotHandUp(s) || s.auraRemains('player', 'whirling_fire') > 0)
      && s.isUsable('lava_lash') === true) return 'lava_lash'
    if (s.isUsable('voltaic_blaze') === true) return 'voltaic_blaze'
    if (s.isUsable('doom_winds') === true) return 'doom_winds'
    if (s.isUsable('crash_lightning') === true) return 'crash_lightning'
    if (msw >= 10 && s.auraRemains('player', 'primordial_storm_ready') > 0) return 'primordial_storm'
    if (doomUp(s) && s.isUsable('stormstrike') === true) return 'stormstrike'
    if (msw >= 10) return 'lightning_bolt'
    if (s.isUsable('lava_lash') === true) return 'lava_lash'
    if (s.isUsable('stormstrike') === true) return 'stormstrike'
    if (msw >= 5) return 'lightning_bolt'
    return null // pool Maelstrom for the next spender
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const strikes = ['stormstrike', 'lava_lash', 'crash_lightning']
    const spenders = ['lightning_bolt', 'primordial_storm']
    const sets = [strikes, spenders]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
