import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Frost Death Knight — patch 12.1.0 (Midnight, Season 2), Deathbringer +
 * Breath of Sindragosa raid ST build (Icy Veins default), dual-wield.
 * Built from the simc `midnight` APL/source and Icy Veins/Method/Maxroll.
 *
 * Resource model (simc-confirmed): 6 runes, 10s hasted recharge, max 3
 * recharging at once; RP cap 100; 10 RP per rune spent; Runic Empowerment
 * 1.8% per RP spent.
 * Talent assumptions: Shattering Blade, Icy Onslaught, Icy Death Torrent,
 * Obliteration NOT taken (BoS build), Apex: Chosen of the Frostbrood 3/3.
 * APPROX-flagged: auto-attack cadence/damage, Reaper's Mark stack pacing,
 * S2 tier folded into Remorseless Winter tick count. Damage in AP units.
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
const RM_INITIAL = 2.34
const RM_PER_STACK = 0.30364
const AUTO_COEFF = 0.35        // APPROX
const IDT_COEFF = 1.4
const SHATTERING_MULT = 2.15   // Frost Strike at 5 Razorice: +115%

function km(s: SimAPI): number {
  return s.stacks('player', 'killing_machine')
}

/** frost damage with Razorice vulnerability */
function frostDamage(s: SimAPI, id: string, coeff: number, opts?: { canCrit?: boolean }) {
  const razorice = 1 + 0.03 * s.stacks('target', 'razorice')
  s.damage(id, coeff * razorice, { ...opts, tags: ['frost'] })
  // Deathbringer: Reaper's Mark counts Frost/Shadow damage events
  const mark = s.aura('target', 'reapers_mark')
  if (mark) mark.data.stacks_counted = Math.min(40, (mark.data.stacks_counted ?? 0) + 1)
}

function addRazorice(s: SimAPI) {
  s.applyAura('target', 'razorice', { stacks: 1 })
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
  resourceName: 'Runic Power',
  resourceMax: 100,
  startingResource: 20,
  runes: { max: 6, rechargeTime: 10 },

  onCombatStart: (s) => {
    // dual-wield auto-attacks: combined stream, hasted; crits roll Killing
    // Machine (30% accumulator stand-in) and Icy Death Torrent (50%)
    const swing = () => {
      s.damage('Auto Attack', AUTO_COEFF)
      if (s.rng('auto_crit') < s.stats.critChance) {
        if (s.rng('killing_machine') < 0.30) s.applyAura('player', 'killing_machine', { stacks: 1 })
        if (s.rng('icy_death_torrent') < 0.50) frostDamage(s, 'Icy Death Torrent', IDT_COEFF)
      }
      s.schedule(s.time + 1.3 * s.hasteMult(), swing)
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
      id: 'remorseless_winter', name: 'Remorseless Winter', icon: 'ability_deathknight_remorselesswinters2', duration: 8,
      // 4pc: ticks 25% more frequently → 11 ticks over 8s
      tick: { interval: 0.72, hasted: false, onTick: s => frostDamage(s, 'remorseless_winter', RW_TICK) },
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
    {
      id: 'reapers_mark', name: "Reaper's Mark", icon: 'inv_ability_deathbringerdeathknight_reapersmark', duration: 12, debuff: true,
      onExpire: (s, aura) => {
        const stacks = aura.data.stacks_counted ?? 0
        s.damage("Reaper's Mark", RM_INITIAL + RM_PER_STACK * stacks)
        // Exterminate (simplified): detonation grants Killing Machine
        s.applyAura('player', 'killing_machine', { stacks: 2 })
      },
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
      },
    },
    {
      id: 'frost_strike',
      name: 'Frost Strike',
      icon: 'spell_deathknight_empowerruneblade2',
      spellId: 49143,
      cost: 35,
      costMod: (s) => 35 + 5 * s.stacks('player', 'icy_onslaught'),
      onResolve: (s) => {
        const onslaught = 1 + 0.15 * s.stacks('player', 'icy_onslaught')
        const cost = 35 + 5 * s.stacks('player', 'icy_onslaught')
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
        else s.gain(10, 'howling_blast')
        frostDamage(s, 'howling_blast', HB_COEFF * (rime ? RIME_HB_MULT : 1))
        s.applyAura('target', 'frost_fever')
      },
    },
    {
      id: 'remorseless_winter',
      name: 'Remorseless Winter',
      icon: 'ability_deathknight_remorselesswinters2',
      spellId: 196770,
      runeCost: 1,
      cooldown: 20,
      onResolve: (s) => {
        s.gain(10, 'rw')
        s.applyAura('player', 'remorseless_winter')
      },
    },
    {
      id: 'pillar_of_frost',
      name: 'Pillar of Frost',
      icon: 'ability_deathknight_pillaroffrost',
      spellId: 51271,
      cooldown: 45,
      offGcd: true,
      onResolve: (s) => s.applyAura('player', 'pillar_of_frost'),
    },
    {
      id: 'empower_rune_weapon',
      name: 'Empower Rune Weapon',
      icon: 'inv_sword_62',
      spellId: 47568,
      cooldown: 30,
      charges: 2,
      onResolve: (s) => {
        s.gain(40, 'erw')
        s.applyAura('player', 'killing_machine', { stacks: 1 })
        s.damage('empower_rune_weapon', ERW_COEFF, { tags: ['frost'] })
      },
    },
    {
      // Apex: recastable within 45s at 50% via the recall buff (button transforms)
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
      usable: (s) => (s.insanity >= 40 ? true : 'pool Runic Power first (40+)'),
      onResolve: (s) => {
        s.applyAura('player', 'breath_of_sindragosa')
        s.refundRune() // grants a rune at the start
      },
    },
    {
      id: 'reapers_mark',
      name: "Reaper's Mark",
      icon: 'inv_ability_deathbringerdeathknight_reapersmark',
      spellId: 439843,
      runeCost: 2,
      cooldown: 45,
      onResolve: (s) => {
        s.damage('reapers_mark', RM_INITIAL, { tags: ['frost'] })
        s.applyAura('target', 'reapers_mark')
      },
    },
  ],

  actionBar: [
    'obliterate', 'frost_strike', 'howling_blast', 'remorseless_winter',
    'reapers_mark', 'pillar_of_frost', 'breath_of_sindragosa',
    'empower_rune_weapon', 'frostwyrms_fury',
  ],

  damageMult: (s, _id, tags) => {
    let m = 1
    if (s.auraRemains('player', 'pillar_of_frost') > 0) m *= 1.20
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
    { abilityId: 'remorseless_winter', text: 'On cooldown (S2 tier engine)', when: s => s.cooldownRemains('remorseless_winter') === 0 },
    { abilityId: 'pillar_of_frost', text: 'On cooldown, with RP pooled if Breath is coming', when: s => s.cooldownRemains('pillar_of_frost') === 0 },
    { abilityId: 'breath_of_sindragosa', text: 'Off-GCD, inside Pillar, with 60+ RP pooled', when: s => s.cooldownRemains('breath_of_sindragosa') === 0 },
    { abilityId: 'reapers_mark', text: 'Inside Pillar (or Pillar >5s away)', when: s => s.cooldownRemains('reapers_mark') === 0 },
    { abilityId: 'frostwyrms_fury', text: 'After Pillar starts; recall press while the buff lasts', when: s => s.cooldownRemains('frostwyrms_fury') === 0 || s.auraRemains('player', 'fwf_recall') > 0 },
    { abilityId: 'obliterate', text: 'With Killing Machine — at 2 stacks, always; at 1 with 3+ runes' },
    { abilityId: 'frost_strike', text: 'At 5 Razorice (Shattering Blade)', when: s => s.stacks('target', 'razorice') === 5 },
    { abilityId: 'howling_blast', text: 'With Rime (free, +275%) — and keep Frost Fever up', when: s => s.auraRemains('player', 'rime') > 0 },
    { abilityId: 'frost_strike', text: 'Never cap Runic Power (deficit <30)' },
    { abilityId: 'empower_rune_weapon', text: 'When rune/KM-starved and RP is low', when: s => s.chargesOf('empower_rune_weapon') > 0 },
    { abilityId: 'obliterate', text: 'Without KM — last resort' },
  ],

  policy: (s) => {
    const rp = s.insanity
    const runes = s.runesReady()
    const bosUp = s.auraRemains('player', 'breath_of_sindragosa') > 0
    const bosCd = s.cooldownRemains('breath_of_sindragosa')
    const pillarUp = s.auraRemains('player', 'pillar_of_frost') > 0
    const rpPooling = bosCd < 5 && !bosUp && rp < 60
    const runePooling = s.cooldownRemains('reapers_mark') < 6 && runes < 3

    // cooldowns
    if (s.auraRemains('target', 'frost_fever') <= 0) return 'howling_blast'
    if (s.isUsable('remorseless_winter') === true && s.timeToUsable('remorseless_winter') === 0) return 'remorseless_winter'
    if (s.cooldownRemains('pillar_of_frost') === 0 && (bosCd > 30 || rp >= 60)) return 'pillar_of_frost'
    if (bosCd === 0 && !bosUp && pillarUp && s.isUsable('breath_of_sindragosa') === true) return 'breath_of_sindragosa'
    if (s.isUsable('reapers_mark') === true && s.timeToUsable('reapers_mark') === 0
      && (pillarUp || s.cooldownRemains('pillar_of_frost') > 5)) return 'reapers_mark'
    if (s.cooldownRemains('frostwyrms_fury') === 0 && pillarUp && s.timeToUsable('frostwyrms_fury') === 0) return 'frostwyrms_fury'
    if (s.auraRemains('player', 'fwf_recall') > 0 && s.auraRemains('player', 'fwf_recall') < 6) return 'frostwyrms_fury'
    if (s.chargesOf('empower_rune_weapon') > 0 && (runes < 2 || km(s) === 0)
      && rp < 35 + 5 * s.stacks('player', 'icy_onslaught')) return 'empower_rune_weapon'

    // single target core (simc order)
    if ((km(s) === 2 || (km(s) >= 1 && runes >= 3)) && s.isUsable('obliterate') === true) return 'obliterate'
    if (s.stacks('target', 'razorice') === 5 && !rpPooling && s.isUsable('frost_strike') === true) return 'frost_strike'
    if (s.auraRemains('player', 'rime') > 0) return 'howling_blast'
    if (100 - rp < 30 && s.isUsable('frost_strike') === true) return 'frost_strike'
    if (km(s) >= 1 && !runePooling && s.isUsable('obliterate') === true) return 'obliterate'
    if (!rpPooling && s.isUsable('frost_strike') === true) return 'frost_strike'
    if (!runePooling && s.isUsable('obliterate') === true) return 'obliterate'
    if (s.isUsable('howling_blast') === true && runes >= 1) return 'howling_blast'
    return null
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const strikes = ['obliterate', 'frost_strike']
    const fillers = ['howling_blast', 'frost_strike']
    const sets = [strikes, fillers]
    return sets.some(set => set.includes(pressed) && set.includes(oracle))
  },
}
