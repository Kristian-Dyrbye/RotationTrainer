import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Frost Death Knight — patch 12.1.0 (Midnight, Season 2), Rider of the
 * Apocalypse + Breath of Sindragosa dual-wield raid ST build. Verified
 * 2026-08-24 against Wowhead's rotation guide, Icy Veins ("Frost Single
 * Target" raid build, which also publishes the talent string below),
 * Method, and Maxroll's 12.1 raid guide. Maxroll/Icy Veins both put Rider
 * ~1% ahead of Deathbringer on ST; the button rotation is identical.
 *
 * Sources:
 * - https://www.wowhead.com/guide/classes/death-knight/frost/rotation-cooldowns-pve-dps
 * - https://www.icy-veins.com/wow/frost-death-knight-pve-dps-rotation-cooldowns-abilities
 * - https://www.icy-veins.com/wow/frost-death-knight-pve-dps-spec-builds-talents
 * - https://www.method.gg/guides/frost-death-knight/playstyle-and-rotation
 * - https://maxroll.gg/wow/class-guides/frost-death-knight-raid-guide
 *
 * Talent assumptions: Breath of Sindragosa, Obliteration (Frost Strike /
 * Howling Blast grant Killing Machine during Pillar), Shattering Blade,
 * Icy Onslaught (flex), Icy Death Torrent, Frozen Dominion (Pillar of Frost
 * auto-casts a free Remorseless Winter; it is no longer castable on its own),
 * Apex: Chosen of the Frostbrood, Rider: Apocalypse Now (Frostwyrm's Fury
 * calls all four Horsemen for 20s) + Rider's Champion.
 * S2 tier ("Freezing Tempest"): 2pc — each Remorseless Winter tick grants
 * +2% attack speed and +4% Icy Death Torrent damage, stacking; 4pc — RW
 * ticks 25% more often and the buff lasts 5s longer (10s total).
 *
 * Resource model (unchanged from simc): 6 runes, 10s hasted recharge, max 3
 * recharging; RP cap 100; 10 RP per rune spent; Runic Empowerment 1.8%/RP.
 * APPROX-flagged: auto-attack cadence/damage, Horsemen pulse damage and
 * Rider's Champion proc rate, Breath drain fixed at 16 RP/s, Mograine's
 * Death and Decay folded into a flat +5% while Horsemen are out.
 */

const OBLIT_COEFF = 2.16       // DW both hands, phys+frost
const FS_COEFF = 2.32          // DW Frost Strike
const HB_COEFF = 0.44
const RIME_HB_MULT = 3.75      // Rime: +275%
const FF_TICK = 0.428          // Frost Fever: 342% AP / 8 ticks
const RW_TICK = 0.126
const ERW_COEFF = 2.6
const FWF_COEFF = 2.966 * 2    // Apex R1: +100% to first target
const BOS_TICK = 1.1183
const AUTO_COEFF = 0.35        // APPROX
const IDT_COEFF = 1.4
const SHATTERING_MULT = 2.15   // Frost Strike at 5 Razorice: +115%
const HORSEMEN_TICK = 0.55     // APPROX: all four Horsemen combined, per pulse
const CHAMPION_PULSE = 0.35    // APPROX: single Rider's Champion Horseman

function km(s: SimAPI): number {
  return s.stacks('player', 'killing_machine')
}

function fsCost(s: SimAPI): number {
  return 35 + 5 * s.stacks('player', 'icy_onslaught')
}

/** frost damage with Razorice vulnerability */
function frostDamage(s: SimAPI, id: string, coeff: number, opts?: { canCrit?: boolean }) {
  const razorice = 1 + 0.03 * s.stacks('target', 'razorice')
  s.damage(id, coeff * razorice, { ...opts, tags: ['frost'] })
}

function addRazorice(s: SimAPI) {
  s.applyAura('target', 'razorice', { stacks: 1 })
}

/** Obliteration: Frost Strike / Howling Blast grant KM during Pillar */
function obliterationKm(s: SimAPI) {
  if (s.auraRemains('player', 'pillar_of_frost') > 0) {
    s.applyAura('player', 'killing_machine', { stacks: 1 })
  }
}

/** Rider's Champion: rune spends can call a lone Horseman (APPROX rate) */
function riderRoll(s: SimAPI, runes: number) {
  for (let i = 0; i < runes; i++) {
    if (s.rng('rider') < 0.12) {
      for (let j = 1; j <= 8; j++) {
        s.schedule(s.time + j * 1.1, () => s.damage('Horseman', CHAMPION_PULSE))
      }
    }
  }
}

/** RP spender bookkeeping: Runic Empowerment + Icy Onslaught reset */
function onRpSpent(s: SimAPI, baseCost: number) {
  if (s.rng('runic_empowerment') < 0.018 * baseCost) {
    s.refundRune()
    s.removeAura('player', 'icy_onslaught') // RE proc resets Icy Onslaught
  }
}

export const frostDK: SpecConfig = {
  name: 'Frost Death Knight',
  specId: 'dk-frost',
  specIcon: 'spell_deathknight_frostpresence',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/death-knight/frost/rotation-cooldowns-pve-dps',
    buildName: 'Rider Breath (dual-wield) Raid ST',
    heroTalent: 'Rider of the Apocalypse',
    // Icy Veins "Frost Single Target" raid build import
    talentString: 'CsPAAAAAAAAAAAAAAAAAAAAAAMDwMjZmZGDz2MzMzMLmZmMjxYYmxgZMzMzMzMDAAAAAAAAAgNzihBGY2YohNMzYmZgBgBgZGgB',
    retrieved: '2026-08-24',
  },
  resourceName: 'Runic Power',
  resourceMax: 100,
  startingResource: 20,
  runes: { max: 6, rechargeTime: 10 },

  onCombatStart: (s) => {
    // dual-wield auto-attacks: combined stream, hasted, sped up by Freezing
    // Tempest (S2 2pc); crits roll Killing Machine (30% accumulator stand-in)
    // and Icy Death Torrent (50%)
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      if (s.rng('auto_crit') < s.stats.critChance) {
        if (s.rng('killing_machine') < 0.30) s.applyAura('player', 'killing_machine', { stacks: 1 })
        if (s.rng('icy_death_torrent') < 0.50) frostDamage(s, 'Icy Death Torrent', IDT_COEFF)
      }
      const tempest = 1 + 0.02 * s.stacks('player', 'freezing_tempest')
      s.schedule(s.time + (1.3 * s.hasteMult()) / tempest, swing)
    }
    s.schedule(s.time + 0.1, swing)
  },

  auras: [
    { id: 'killing_machine', name: 'Killing Machine', icon: 'inv_sword_122', duration: 10, maxStacks: 2 },
    { id: 'rime', name: 'Rime', icon: 'spell_frost_freezingbreath', duration: 15 },
    { id: 'razorice', name: 'Razorice', icon: 'spell_deathknight_frozenruneweapon', duration: 20, maxStacks: 5, debuff: true },
    { id: 'icy_onslaught', name: 'Icy Onslaught', icon: 'ability_deathknight_chillstreak', duration: 30, maxStacks: 5 },
    { id: 'pillar_of_frost', name: 'Pillar of Frost', icon: 'ability_deathknight_pillaroffrost', duration: 12 },
    { id: 'frostbrood_haste', name: 'Chosen of the Frostbrood', icon: 'inv12_apextalent_deathknight_chosenofthefrostbrood', duration: 12 },
    { id: 'fwf_recall', name: "Frostwyrm's Recall", icon: 'achievement_boss_sindragosa', duration: 45 },
    {
      // S2 2pc: stacks per Remorseless Winter tick; 4pc: 10s duration
      id: 'freezing_tempest', name: 'Freezing Tempest', icon: 'spell_frost_frostarmor02', duration: 10, maxStacks: 12,
    },
    {
      // Apocalypse Now: Frostwyrm's Fury calls all four Horsemen for 20s
      id: 'horsemen', name: 'The Four Horsemen', icon: 'spell_deathknight_summondeathcharger', duration: 20,
      tick: { interval: 1, hasted: false, onTick: s => s.damage('Horseman', HORSEMEN_TICK * 4) },
    },
    {
      id: 'frost_fever', name: 'Frost Fever', icon: 'spell_deathknight_frostfever', duration: 24, pandemic: true, debuff: true,
      tick: {
        interval: 3, hasted: true,
        onTick: (s) => {
          frostDamage(s, 'frost_fever', FF_TICK)
          if (s.rng('frost_fever_rp') < 0.30) s.gain(4, 'frost_fever') // APPROX chance
        },
      },
    },
    {
      // auto-cast by Pillar of Frost via Frozen Dominion — not a button
      id: 'remorseless_winter', name: 'Remorseless Winter', icon: 'ability_deathknight_remorselesswinters2', duration: 8,
      // 4pc: ticks 25% more frequently → 11 ticks over 8s; each tick stacks the 2pc buff
      tick: {
        interval: 0.72, hasted: false,
        onTick: (s) => {
          frostDamage(s, 'remorseless_winter', RW_TICK)
          s.applyAura('player', 'freezing_tempest', { stacks: 1 })
        },
      },
    },
    {
      id: 'breath_of_sindragosa', name: 'Breath of Sindragosa', icon: 'spell_deathknight_breathofsindragosa', duration: 60,
      tick: {
        interval: 1, hasted: false,
        onTick: (s) => {
          if (s.insanity >= 16) {
            s.spend(16)
            frostDamage(s, 'breath_of_sindragosa', BOS_TICK)
          } else {
            s.removeAura('player', 'breath_of_sindragosa')
          }
        },
      },
      onExpire: s => s.refundRune(), // BoS grants a rune when it ends
    },
  ],

  abilities: [
    {
      id: 'obliterate',
      name: 'Obliterate',
      icon: 'spell_deathknight_classicon',
      spellId: 49020,
      runeCost: 2,
      onResolve: (s) => {
        s.gain(20, 'obliterate')
        if (km(s) > 0) {
          s.consumeStack('player', 'killing_machine')
          frostDamage(s, 'obliterate', OBLIT_COEFF * s.stats.critMult, { canCrit: false }) // KM: all frost, auto-crit
        } else {
          frostDamage(s, 'obliterate', OBLIT_COEFF)
        }
        addRazorice(s)
        riderRoll(s, 2)
      },
    },
    {
      id: 'frost_strike',
      name: 'Frost Strike',
      icon: 'spell_deathknight_empowerruneblade2',
      spellId: 49143,
      cost: 35,
      costMod: (s) => fsCost(s),
      onResolve: (s) => {
        const onslaught = 1 + 0.15 * s.stacks('player', 'icy_onslaught')
        const cost = fsCost(s)
        let mult = onslaught
        if (s.stacks('target', 'razorice') === 5) {
          // Shattering Blade: consume 5 Razorice, +115%
          mult *= SHATTERING_MULT * (1 + 0.03 * 5)
          s.removeAura('target', 'razorice')
          s.damage('frost_strike', FS_COEFF * mult, { tags: ['frost'] })
        } else {
          frostDamage(s, 'frost_strike', FS_COEFF * mult)
          addRazorice(s)
        }
        s.applyAura('player', 'icy_onslaught', { stacks: 1 })
        if (s.rng('rime') < 0.45) s.applyAura('player', 'rime')
        obliterationKm(s)
        onRpSpent(s, cost)
      },
    },
    {
      id: 'howling_blast',
      name: 'Howling Blast',
      icon: 'spell_frost_arcticwinds',
      spellId: 49184,
      runeCost: 1,
      runeCostMod: (s) => (s.auraRemains('player', 'rime') > 0 ? 0 : 1), // Rime: free
      onResolve: (s) => {
        const rime = s.auraRemains('player', 'rime') > 0
        if (rime) s.removeAura('player', 'rime')
        else {
          s.gain(10, 'howling_blast')
          riderRoll(s, 1)
        }
        frostDamage(s, 'howling_blast', HB_COEFF * (rime ? RIME_HB_MULT : 1))
        s.applyAura('target', 'frost_fever')
        obliterationKm(s)
      },
    },
    {
      id: 'pillar_of_frost',
      name: 'Pillar of Frost',
      icon: 'ability_deathknight_pillaroffrost',
      spellId: 51271,
      cooldown: 45,
      offGcd: true,
      onResolve: (s) => {
        s.applyAura('player', 'pillar_of_frost')
        // Frozen Dominion: Pillar activates a free Remorseless Winter
        s.applyAura('player', 'remorseless_winter')
      },
    },
    {
      id: 'empower_rune_weapon',
      name: 'Empower Rune Weapon',
      icon: 'inv_sword_62',
      spellId: 47568,
      cooldown: 30,
      charges: 2,
      offGcd: true,
      onResolve: (s) => {
        s.gain(40, 'erw')
        s.applyAura('player', 'killing_machine', { stacks: 1 })
        s.damage('empower_rune_weapon', ERW_COEFF, { tags: ['frost'] })
      },
    },
    {
      // Apex: recastable within 45s at 50% via the recall buff; Apocalypse
      // Now: the full cast calls all four Horsemen for 20s
      id: 'frostwyrms_fury',
      name: "Frostwyrm's Fury",
      icon: 'achievement_boss_sindragosa',
      spellId: 279302,
      cooldown: 90,
      noCooldownIf: (s) => s.auraRemains('player', 'fwf_recall') > 0,
      displayStacks: (s) => (s.auraRemains('player', 'fwf_recall') > 0 ? 1 : 0),
      onResolve: (s) => {
        if (s.auraRemains('player', 'fwf_recall') > 0) {
          s.removeAura('player', 'fwf_recall')
          frostDamage(s, 'frostwyrms_fury', FWF_COEFF * 0.5)
        } else {
          frostDamage(s, 'frostwyrms_fury', FWF_COEFF)
          s.applyAura('player', 'frostbrood_haste') // Apex: +15% haste 12s
          s.extendAura('player', 'pillar_of_frost', 3) // Apex R2 (APPROX: 3s)
          s.applyAura('player', 'horsemen') // Apocalypse Now
          s.applyAura('player', 'fwf_recall')
        }
      },
    },
    {
      id: 'breath_of_sindragosa',
      name: 'Breath of Sindragosa',
      icon: 'spell_deathknight_breathofsindragosa',
      spellId: 152279,
      cooldown: 120,
      offGcd: true,
      usable: (s) => (s.insanity >= 60 ? true : 'pool 60+ Runic Power first'),
      onResolve: (s) => {
        s.applyAura('player', 'breath_of_sindragosa')
        s.refundRune() // grants a rune at the start
      },
    },
  ],

  actionBar: [
    'obliterate', 'frost_strike', 'howling_blast', 'pillar_of_frost',
    'breath_of_sindragosa', 'empower_rune_weapon', 'frostwyrms_fury',
  ],

  damageMult: (s, id, _tags) => {
    let m = 1
    if (s.auraRemains('player', 'pillar_of_frost') > 0) m *= 1.20
    // Mograine's Death and Decay while the Horsemen ride (APPROX flat)
    if (s.auraRemains('player', 'horsemen') > 0) m *= 1.05
    // S2 2pc: +4% Icy Death Torrent damage per Freezing Tempest stack
    if (id === 'Icy Death Torrent') m *= 1 + 0.04 * s.stacks('player', 'freezing_tempest')
    return m
  },
  hasteMod: (s) => (s.auraRemains('player', 'frostbrood_haste') > 0 ? 0.15 : 0),

  glows: (s, id) => {
    switch (id) {
      case 'obliterate': return km(s) > 0
      case 'howling_blast': return s.auraRemains('player', 'rime') > 0
      case 'frost_strike': return s.stacks('target', 'razorice') === 5
      case 'frostwyrms_fury': return s.auraRemains('player', 'fwf_recall') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'howling_blast', text: 'Keep Frost Fever up', when: s => s.auraRemains('target', 'frost_fever') <= 3 },
    { abilityId: 'empower_rune_weapon', text: 'At 2 charges — never sit capped', when: s => s.chargesOf('empower_rune_weapon') === 2 },
    { abilityId: 'pillar_of_frost', text: 'On cooldown; pool 60+ RP first when Breath is coming (auto-casts Remorseless Winter — Frozen Dominion)', when: s => s.cooldownRemains('pillar_of_frost') === 0 },
    { abilityId: 'breath_of_sindragosa', text: 'Off-GCD, inside Pillar, with 60+ RP pooled — Obliterate feeds it', when: s => s.cooldownRemains('breath_of_sindragosa') === 0 },
    { abilityId: 'frostwyrms_fury', text: 'With Pillar — calls the Four Horsemen; press again once the 15% haste buff ends', when: s => s.cooldownRemains('frostwyrms_fury') === 0 || s.auraRemains('player', 'fwf_recall') > 0 },
    { abilityId: 'obliterate', text: 'At 2 Killing Machine always; at 1 KM with 3+ runes outside Pillar' },
    { abilityId: 'frost_strike', text: 'At 5 Razorice (Shattering Blade) — never during Breath', when: s => s.stacks('target', 'razorice') === 5 },
    { abilityId: 'howling_blast', text: 'With Rime (free, +275%)', when: s => s.auraRemains('player', 'rime') > 0 },
    { abilityId: 'frost_strike', text: 'Never cap Runic Power (deficit <25)' },
    { abilityId: 'obliterate', text: 'With Killing Machine' },
    { abilityId: 'empower_rune_weapon', text: 'When KM/RP-starved (keep Breath alive!)', when: s => s.chargesOf('empower_rune_weapon') > 0 },
    { abilityId: 'frost_strike', text: 'Filler outside Breath' },
    { abilityId: 'howling_blast', text: 'During Pillar without Rime — Obliteration turns it into Killing Machine', when: s => s.auraRemains('player', 'pillar_of_frost') > 0 },
    { abilityId: 'obliterate', text: 'No KM, outside Pillar — last resort' },
  ],

  policy: (s) => {
    const rp = s.insanity
    const runes = s.runesReady()
    const bosUp = s.auraRemains('player', 'breath_of_sindragosa') > 0
    const bosCd = s.cooldownRemains('breath_of_sindragosa')
    const pillarUp = s.auraRemains('player', 'pillar_of_frost') > 0
    const rpPooling = bosCd < 10 && !bosUp && rp < 60

    // maintenance + cooldowns
    if (s.auraRemains('target', 'frost_fever') <= 3 && s.isUsable('howling_blast') === true) return 'howling_blast'
    if (s.chargesOf('empower_rune_weapon') === 2) return 'empower_rune_weapon'
    if (s.cooldownRemains('pillar_of_frost') === 0 && (bosCd > 30 || rp >= 60)) return 'pillar_of_frost'
    if (bosCd === 0 && !bosUp && pillarUp && s.isUsable('breath_of_sindragosa') === true) return 'breath_of_sindragosa'
    if (s.cooldownRemains('frostwyrms_fury') === 0 && pillarUp && s.timeToUsable('frostwyrms_fury') === 0) return 'frostwyrms_fury'
    if (s.auraRemains('player', 'fwf_recall') > 0 && s.auraRemains('player', 'frostbrood_haste') <= 0) return 'frostwyrms_fury'
    if (bosUp && rp < 32 && s.chargesOf('empower_rune_weapon') > 0) return 'empower_rune_weapon'

    // single target core (Wowhead/Maxroll order)
    if ((km(s) === 2 || (km(s) >= 1 && runes >= 3 && !pillarUp)) && s.isUsable('obliterate') === true) return 'obliterate'
    if (s.stacks('target', 'razorice') === 5 && !bosUp && !rpPooling && s.isUsable('frost_strike') === true) return 'frost_strike'
    if (s.auraRemains('player', 'rime') > 0) return 'howling_blast'
    if (100 - rp < 25 && !bosUp && s.isUsable('frost_strike') === true) return 'frost_strike'
    if (km(s) >= 1 && s.isUsable('obliterate') === true) return 'obliterate'
    if (s.chargesOf('empower_rune_weapon') > 0 && km(s) === 0 && rp < fsCost(s)) return 'empower_rune_weapon'
    if (!bosUp && !rpPooling && s.isUsable('frost_strike') === true) return 'frost_strike'
    if (pillarUp && s.isUsable('howling_blast') === true) return 'howling_blast' // Obliteration KM fishing
    if (!pillarUp && s.isUsable('obliterate') === true) return 'obliterate'
    return null
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const strikes = ['obliterate', 'frost_strike']
    const fillers = ['howling_blast', 'frost_strike']
    const sets = [strikes, fillers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
