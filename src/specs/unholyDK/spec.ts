import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Unholy Death Knight — patch 12.1.0 (Midnight, Season 2), Rider of the
 * Apocalypse raid ST build with the S2 tier. Built from the simc `midnight`
 * APL/source and Icy Veins/Method/Maxroll 12.1 guides.
 *
 * THE 12.1 rework, encoded here (TWW priors are wrong): Festering Wounds are
 * GONE. Festering Strike arms 2-3 Lesser Ghoul charges on YOU; Scourge Strike
 * spends one to summon a ghoul; Putrefy detonates a ghoul and reanimates it
 * into a Magus; 3 Magi sacrifice into a Lord of the Dead. Apocalypse, Unholy
 * Assault, and Festermight no longer exist. Army of the Dead is a 90s window
 * that opens Forbidden Knowledge (Apex): Death Coil becomes Necrotic Coil.
 *
 * Resource model (simc-confirmed): 6 runes / 10s hasted / max 3 recharging;
 * RP cap 100; +10 RP per 1-rune spender; Death Coil 30 RP (15 w/ Sudden Doom).
 * APPROX-flagged: pet damage pulses, Rider Horseman proc rate, Runic
 * Corruption folded into rune refunds. Damage in AP units.
 */

const FESTERING_COEFF = 2.025
const SCOURGE_COEFF = 1.35
const ERUPT_MULT = 0.35        // plagues erupt at 35% on Scourge Strike
const COIL_COEFF = 2.118
const NECROTIC_COIL_COEFF = 2.053 + 0.646 // Forbidden Knowledge window
const OUTBREAK_COEFF = 0.3    // APPROX small direct
const VP_TICK = 0.2536
const DP_TICK = 0.5489
const PUTREFY_COEFF = 1.997 + 1.394
const GHOUL_PULSE = 0.30       // APPROX per lesser-ghoul hit
const MAGUS_PULSE = 0.4664 * 1.15 // S2 2pc folded in
const LORD_PULSE = 0.7 * 1.3      // APPROX incl. magus-time scaling + tier
const ARMY_PULSE = 1.1            // APPROX: 8 ghouls condensed per second
const HORSEMAN_PULSE = 0.35       // APPROX
const SD_COIL_MULT = 1.35

function dtUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'dark_transformation') > 0
}

function petMult(s: SimAPI): number {
  return dtUp(s) ? 3.75 : 1 // Dark Transformation +200% pet damage, Commander +25%
}

/** summon a Lesser Ghoul pet for 8s */
function summonGhoul(s: SimAPI) {
  for (let i = 1; i <= 6; i++) {
    s.schedule(s.time + i * 1.3, () => s.damage('Lesser Ghoul', GHOUL_PULSE * petMult(s)))
  }
}

/** Magus of the Dead: 15s caster; the 3rd concurrent Magus summons the Lord */
function summonMagus(s: SimAPI) {
  s.applyAura('player', 'magi', { stacks: 1 })
  for (let i = 1; i <= 10; i++) {
    s.schedule(s.time + i * 1.5, () => {
      if (s.stacks('player', 'magi') > 0) s.damage('Magus of the Dead', MAGUS_PULSE * petMult(s))
    })
  }
  if (s.stacks('player', 'magi') >= 3) {
    s.removeAura('player', 'magi')
    s.applyAura('player', 'lord_of_the_dead')
  }
}

/** extend both plagues (Death Coil rider) */
function extendPlagues(s: SimAPI, seconds: number) {
  s.extendAura('target', 'virulent_plague', seconds)
  s.extendAura('target', 'dread_plague', seconds)
  s.extendAura('player', 'dark_transformation', seconds)
}

/** Rider of the Apocalypse: chance per rune spent to summon a Horseman */
function riderRoll(s: SimAPI, runes: number) {
  for (let i = 0; i < runes; i++) {
    if (s.rng('rider') < 0.15) { // APPROX: proc rate unpublished
      for (let j = 1; j <= 9; j++) {
        s.schedule(s.time + j * 1.1, () => s.damage('Horseman', HORSEMAN_PULSE))
      }
    }
  }
}

/** RP spend bookkeeping: Runic Corruption approximated as partial rune refunds */
function onRpSpent(s: SimAPI, cost: number) {
  if (s.rng('runic_corruption') < 0.02 * cost * 0.9) s.refundRune()
}

export const unholyDK: SpecConfig = {
  name: 'Unholy Death Knight',
  specId: 'dk-unholy',
  specIcon: 'spell_deathknight_unholypresence',
  resourceName: 'Runic Power',
  resourceMax: 100,
  startingResource: 20,
  runes: { max: 6, rechargeTime: 10 },

  onCombatStart: (s) => {
    // permanent ghoul (Raise Dead precombat)
    const swing = () => {
      s.damage('Ghoul', 0.15 * petMult(s))
      s.schedule(s.time + 1.5 * s.hasteMult(), swing)
    }
    s.schedule(s.time + 0.5, swing)
  },

  auras: [
    {
      id: 'virulent_plague', name: 'Virulent Plague', icon: 'ability_creature_disease_02', duration: 24, pandemic: true, debuff: true,
      tick: { interval: 3, hasted: true, onTick: s => s.damage('virulent_plague', VP_TICK) },
    },
    {
      id: 'dread_plague', name: 'Dread Plague', icon: 'inv12_ability_deathknight_empowereddreadplague', duration: 24, pandemic: true, debuff: true,
      tick: {
        interval: 3, hasted: true,
        onTick: (s) => {
          s.damage('dread_plague', DP_TICK)
          // Sudden Doom: 35% per tick (PRD approximated as flat roll)
          if (s.rng('sudden_doom') < 0.35) s.applyAura('player', 'sudden_doom')
        },
      },
    },
    { id: 'lesser_ghoul_ready', name: 'Lesser Ghoul charges', icon: 'inv_pet_ghoul', duration: 30, maxStacks: 6 },
    { id: 'sudden_doom', name: 'Sudden Doom', icon: 'spell_shadow_painspike', duration: 10 },
    { id: 'dark_transformation', name: 'Dark Transformation', icon: 'achievement_boss_festergutrotface', duration: 15 },
    { id: 'magi', name: 'Magus of the Dead', icon: 'ability_maldraxxus_mage', duration: 15, maxStacks: 3 },
    {
      id: 'lord_of_the_dead', name: 'Lord of the Dead', icon: 'achievement_dungeon_thenecroticwake_nalthor', duration: 15,
      tick: { interval: 1.5, hasted: false, onTick: s => s.damage('Lord of the Dead', LORD_PULSE * petMult(s)) },
    },
    {
      id: 'army', name: 'Army of the Dead', icon: 'spell_deathknight_armyofthedead', duration: 30,
      tick: { interval: 1, hasted: false, onTick: s => s.damage('Army of the Dead', ARMY_PULSE * petMult(s)) },
    },
    { id: 'forbidden_knowledge', name: 'Forbidden Knowledge', icon: 'inv12_ability_deathknight_putrefy', duration: 30 },
  ],

  abilities: [
    {
      id: 'festering_strike',
      name: 'Festering Strike',
      icon: 'spell_deathknight_festering_strike',
      spellId: 85948,
      runeCost: 2,
      onResolve: (s) => {
        s.damage('festering_strike', FESTERING_COEFF)
        const charges = s.rng('festering_charges') < 0.5 ? 2 : 3
        s.applyAura('player', 'lesser_ghoul_ready', { stacks: charges })
        riderRoll(s, 2)
      },
    },
    {
      id: 'scourge_strike',
      name: 'Scourge Strike',
      icon: 'spell_deathknight_scourgestrike',
      spellId: 55090,
      runeCost: 1,
      onResolve: (s) => {
        s.gain(10, 'scourge_strike')
        s.damage('scourge_strike', SCOURGE_COEFF)
        // plagues erupt at 35%
        let erupt = 0
        if (s.auraRemains('target', 'virulent_plague') > 0) erupt += VP_TICK
        if (s.auraRemains('target', 'dread_plague') > 0) erupt += DP_TICK
        if (erupt > 0) s.damage('Plague Eruption', erupt * ERUPT_MULT)
        if (s.stacks('player', 'lesser_ghoul_ready') > 0) {
          s.consumeStack('player', 'lesser_ghoul_ready')
          summonGhoul(s)
        }
        riderRoll(s, 1)
      },
    },
    {
      id: 'death_coil',
      name: 'Death Coil',
      icon: 'spell_shadow_deathcoil',
      spellId: 47541,
      cost: 30,
      costMod: (s) => (s.auraRemains('player', 'sudden_doom') > 0 ? 15 : 30),
      onResolve: (s) => {
        const sd = s.auraRemains('player', 'sudden_doom') > 0
        const cost = sd ? 15 : 30
        if (sd) s.removeAura('player', 'sudden_doom')
        const fk = s.auraRemains('player', 'forbidden_knowledge') > 0
        const coeff = fk ? NECROTIC_COIL_COEFF : COIL_COEFF
        s.damage(fk ? 'Necrotic Coil' : 'death_coil', coeff * (sd ? SD_COIL_MULT : 1))
        extendPlagues(s, 1)
        onRpSpent(s, cost)
      },
    },
    {
      id: 'outbreak',
      name: 'Outbreak',
      icon: 'spell_deathvortex',
      spellId: 77575,
      runeCost: 1,
      onResolve: (s) => {
        s.gain(10, 'outbreak')
        s.damage('outbreak', OUTBREAK_COEFF)
        s.applyAura('target', 'virulent_plague')
        s.applyAura('target', 'dread_plague')
        riderRoll(s, 1)
      },
    },
    {
      id: 'dark_transformation',
      name: 'Dark Transformation',
      icon: 'achievement_boss_festergutrotface',
      spellId: 1233448,
      cooldown: 45,
      offGcd: true,
      onResolve: (s) => s.applyAura('player', 'dark_transformation'),
    },
    {
      id: 'army_of_the_dead',
      name: 'Army of the Dead',
      icon: 'spell_deathknight_armyofthedead',
      spellId: 42650,
      runeCost: 1,
      cooldown: 90,
      onResolve: (s) => {
        s.gain(10, 'army')
        s.applyAura('player', 'army')
        s.applyAura('player', 'forbidden_knowledge')
        riderRoll(s, 1)
      },
    },
    {
      id: 'putrefy',
      name: 'Putrefy',
      icon: 'inv12_ability_deathknight_putrefy',
      spellId: 1247378,
      runeCost: 1,
      cooldown: 30,
      charges: 2, // Putrid Echoes
      onResolve: (s) => {
        s.gain(10, 'putrefy')
        s.damage('putrefy', PUTREFY_COEFF * 1.2 * petMult(s)) // Putrid Echoes +20%
        summonMagus(s) // Lord of the Dead: putrefied ghouls reanimate as Magi
        riderRoll(s, 1)
      },
    },
  ],

  actionBar: [
    'festering_strike', 'scourge_strike', 'death_coil', 'outbreak',
    'putrefy', 'dark_transformation', 'army_of_the_dead',
  ],

  glows: (s, id) => {
    switch (id) {
      case 'death_coil': return s.auraRemains('player', 'sudden_doom') > 0
      case 'scourge_strike': return s.stacks('player', 'lesser_ghoul_ready') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'outbreak', text: 'Keep Virulent + Dread Plague up — Dread Plague drives Sudden Doom' },
    { abilityId: 'army_of_the_dead', text: 'On cooldown — opens the 30s Forbidden Knowledge window', when: s => s.cooldownRemains('army_of_the_dead') === 0 },
    { abilityId: 'dark_transformation', text: 'Off-GCD, with Army active (or Army >30s away)', when: s => s.cooldownRemains('dark_transformation') === 0 },
    { abilityId: 'putrefy', text: 'Concentrate charges inside Dark Transformation; bank at most 1', when: s => s.chargesOf('putrefy') > 0 },
    { abilityId: 'death_coil', text: 'Sudden Doom proc — spend immediately (cheap, +35%)', when: s => s.auraRemains('player', 'sudden_doom') > 0 },
    { abilityId: 'death_coil', text: 'During Dark Transformation / Forbidden Knowledge, or near RP cap' },
    { abilityId: 'scourge_strike', text: 'Spend Lesser Ghoul charges (each = a pet ghoul)', when: s => s.stacks('player', 'lesser_ghoul_ready') > 0 },
    { abilityId: 'festering_strike', text: 'Build charges when out — never overcap 6' },
  ],

  policy: (s) => {
    const runes = s.runesReady()
    const rp = s.insanity
    const charges = s.stacks('player', 'lesser_ghoul_ready')
    const armyCd = s.cooldownRemains('army_of_the_dead')

    if (s.auraRemains('target', 'virulent_plague') <= 0 || s.auraRemains('target', 'dread_plague') <= 0) {
      if (s.isUsable('outbreak') === true) return 'outbreak'
    }
    if (s.isUsable('army_of_the_dead') === true && s.timeToUsable('army_of_the_dead') === 0) return 'army_of_the_dead'
    if (s.cooldownRemains('dark_transformation') === 0
      && (s.auraRemains('player', 'army') > 0 || armyCd > 30)) return 'dark_transformation'
    if (dtUp(s) && 100 - rp > 10 && s.isUsable('putrefy') === true && s.timeToUsable('putrefy') === 0) return 'putrefy'
    if (s.auraRemains('player', 'sudden_doom') > 0 && s.isUsable('death_coil') === true) return 'death_coil'
    if (dtUp(s) && s.isUsable('putrefy') === true && s.timeToUsable('putrefy') === 0) return 'putrefy'
    if ((dtUp(s) || s.auraRemains('player', 'forbidden_knowledge') > 0)
      && s.isUsable('death_coil') === true) return 'death_coil'
    if ((armyCd > 5 || 100 - rp < 50) && rp >= 30 && s.isUsable('death_coil') === true && charges === 0) return 'death_coil'
    if (charges >= 1 && s.isUsable('scourge_strike') === true) return 'scourge_strike'
    if (100 - rp < 40 && s.isUsable('death_coil') === true) return 'death_coil'
    if (runes >= 2 && s.isUsable('festering_strike') === true) return 'festering_strike'
    if (rp >= 30 && s.isUsable('death_coil') === true) return 'death_coil'
    return null // pooling runes
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const strikes = ['scourge_strike', 'festering_strike']
    const spenders = ['death_coil']
    void spenders
    return strikes.includes(pressed) && strikes.includes(oracle)
  },
}
