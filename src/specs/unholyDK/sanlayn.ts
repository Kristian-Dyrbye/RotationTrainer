import type { SimAPI, SpecConfig } from '../../engine/types'

/**
 * Unholy Death Knight — patch 12.1.0 (Midnight, Season 2), San'layn raid ST
 * build with the S2 tier (alternate to the default Rider build; Icy Veins:
 * San'layn shines in cleave but trails Rider on raid ST). Verified
 * 2026-08-24 against Wowhead's rotation guide (via search snippets), Icy
 * Veins (rotation + builds pages), Method (which publishes the San'layn
 * priority verbatim), and Maxroll's 12.1 raid guide.
 *
 * Sources:
 * - https://www.wowhead.com/guide/classes/death-knight/unholy/rotation-cooldowns-pve-dps
 * - https://www.icy-veins.com/wow/unholy-death-knight-pve-dps-rotation-cooldowns-abilities
 * - https://www.icy-veins.com/wow/unholy-death-knight-pve-dps-spec-builds-talents
 * - https://www.method.gg/guides/unholy-death-knight/playstyle-and-rotation
 * - https://maxroll.gg/wow/class-guides/unholy-death-knight-raid-guide
 *
 * No talent import string: Icy Veins' builds page publishes strings only
 * for the Rider "Unholy Single-Target" and "Unholy Mythic+/Delves" builds
 * (verified in the raw HTML 2026-08-24 — the San'layn raid build reuses
 * the Rider raid skeleton with the hero tree swapped), so none is quoted.
 *
 * San'layn kit, per the 12.1 guides: Death Coil can proc Vampiric Strike —
 * Scourge Strike transforms, heals, and grants a stack of Essence of the
 * Blood Queen (haste per stack, stack to 7). Gift of the San'layn: during
 * Dark Transformation every Scourge Strike is a Vampiric Strike and Essence
 * is 80% more effective — stack to 7 inside the window, then bridge the
 * buff between windows by fishing procs with Death Coil ("spend all your
 * Runic Power ... if you are about to drop the buff" — Icy Veins).
 * Infliction of Sorrow: Vampiric Strike extends your plagues. The 12.1
 * spec rework is shared with the default build: Festering Wounds are gone;
 * Festering Strike arms Lesser Ghoul charges (max 8), Scourge Strike
 * spends one per cast, Putrefy detonates a ghoul into a Magus (3 Magi →
 * Lord of the Dead), Festering Scythe free-cast when its debuff is
 * missing, Soul Reaper off Reaping (Dark Transformation resets it), Army
 * opens the Forbidden Knowledge (Necrotic Coil) window.
 * S2 tier: 2pc folded into Magus/Lord pulses; 4pc (+130% below 35% target
 * health) UNMODELED — the training dummy has no health.
 *
 * Resource model (unchanged): 6 runes / 10s hasted / max 3 recharging; RP
 * cap 100; +10 RP per rune spent; Death Coil 30 RP (15 w/ Sudden Doom).
 * APPROX-flagged: pet pulse damage, Vampiric Strike proc rate (25% per
 * Death Coil) and coefficient, Essence of the Blood Queen at 1% haste per
 * stack (x1.8 during Dark Transformation), Infliction of Sorrow as a 3s
 * Virulent Plague extension + small burst, Runic Corruption folded into
 * rune refunds, Festering Scythe's tick-rate buff as +25% plague tick
 * damage, Soul Reaper's debuff as a flat +20% for 5s. Blightfall/
 * Blightburst are not modeled (kept in line with the default build's
 * Outbreak-based plague upkeep). Damage in AP units.
 */

const FESTERING_COEFF = 2.025
const SCYTHE_COEFF = 2.4       // APPROX
const SCOURGE_COEFF = 1.35
const VAMP_COEFF = 1.65        // APPROX: Vampiric Strike, shadow + heal
const ERUPT_MULT = 0.35        // plagues erupt at 35% on Scourge Strike
const COIL_COEFF = 2.118
const NECROTIC_COIL_COEFF = 2.053 + 0.646 // Forbidden Knowledge window
const OUTBREAK_COEFF = 0.3    // APPROX small direct
const VP_TICK = 0.2536
const DP_TICK = 0.5489
const PUTREFY_COEFF = 1.997 + 1.394
const SOUL_REAPER_COEFF = 2.8  // APPROX (no execute detonation on a dummy)
const GHOUL_PULSE = 0.30       // APPROX per lesser-ghoul hit
const MAGUS_PULSE = 0.4664 * 1.15 // S2 2pc Necrotic Bolt folded in
const LORD_PULSE = 0.7 * 1.3      // APPROX incl. magus-time scaling + tier
const ARMY_PULSE = 1.1            // APPROX: 8 ghouls (75% stronger) per second
const SD_COIL_MULT = 1.35
const INFLICTION_COEFF = 0.35  // APPROX: Infliction of Sorrow burst portion
const VAMP_PROC = 0.25         // APPROX: Vampiric Strike chance per Death Coil

function dtUp(s: SimAPI): boolean {
  return s.auraRemains('player', 'dark_transformation') > 0
}

function petMult(s: SimAPI): number {
  return dtUp(s) ? 3.75 : 1 // Dark Transformation +200% pet damage, Commander +25%
}

/** is the Festering Strike button currently its Festering Scythe form? */
function scytheReady(s: SimAPI): boolean {
  return s.auraRemains('target', 'festering_scythe') <= 0
}

/** is the Scourge Strike button currently Vampiric Strike? (proc, or Gift
 * of the San'layn for the whole Dark Transformation window) */
function vampReady(s: SimAPI): boolean {
  return dtUp(s) || s.auraRemains('player', 'vampiric_strike') > 0
}

function essence(s: SimAPI): number {
  return s.stacks('player', 'essence_of_the_blood_queen')
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

/** RP spend bookkeeping: Runic Corruption approximated as partial rune refunds */
function onRpSpent(s: SimAPI, cost: number) {
  if (s.rng('runic_corruption') < 0.02 * cost * 0.9) s.refundRune()
}

export const unholyDKSanlayn: SpecConfig = {
  name: 'Unholy Death Knight',
  specId: 'dk-unholy',
  specIcon: 'spell_deathknight_unholypresence',
  buildId: 'sanlayn',
  source: {
    guideUrl: 'https://www.wowhead.com/guide/classes/death-knight/unholy/rotation-cooldowns-pve-dps',
    buildName: "San'layn Raid ST",
    heroTalent: "San'layn",
    // no talentString: Icy Veins publishes import strings only for the
    // Rider builds ("Unholy Single-Target" / "Unholy Mythic+/Delves")
    retrieved: '2026-08-24',
  },
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
    {
      // Festering Scythe: diseases tick faster on the target for 25s
      // (modeled as +25% plague tick damage via damageMult)
      id: 'festering_scythe', name: 'Festering Scythe', icon: 'inv_polearm_2h_mawnecromancerboss_d_01_darkblue', duration: 25, debuff: true,
    },
    {
      // Soul Reaper: pets and diseases empowered for a few seconds
      id: 'soul_reaper', name: 'Soul Reaper', icon: 'ability_deathknight_soulreaper', duration: 5, debuff: true,
    },
    {
      // Reaping: Dark Transformation resets Soul Reaper and lifts its 35% gate
      id: 'reaping', name: 'Reaping', icon: 'ability_deathwing_bloodcorruption_death', duration: 15,
    },
    { id: 'lesser_ghoul_ready', name: 'Lesser Ghoul charges', icon: 'inv_pet_ghoul', duration: 30, maxStacks: 8 },
    { id: 'sudden_doom', name: 'Sudden Doom', icon: 'spell_shadow_painspike', duration: 10 },
    {
      // Gift of the San'layn: Scourge Strike is Vampiric Strike while active
      id: 'dark_transformation', name: 'Dark Transformation', icon: 'achievement_boss_festergutrotface', duration: 15,
    },
    {
      // Vampiric Strike proc (fished with Death Coil between windows)
      id: 'vampiric_strike', name: 'Vampiric Strike', icon: 'inv_ability_sanlayndeathknight_vampiricstrike', duration: 30,
    },
    {
      // haste per stack; 80% more effective during Dark Transformation
      id: 'essence_of_the_blood_queen', name: 'Essence of the Blood Queen', icon: 'ability_ironmaidens_whirlofblood', duration: 20, maxStacks: 7,
    },
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
      // transforms into a free Festering Scythe whenever its debuff is missing
      id: 'festering_strike',
      name: 'Festering Strike',
      icon: 'spell_deathknight_festering_strike',
      spellId: 85948,
      runeCost: 2,
      runeCostMod: (s) => (scytheReady(s) ? 0 : 2),
      displayName: (s) => (scytheReady(s) ? 'Festering Scythe' : 'Festering Strike'),
      displayIcon: (s) => (scytheReady(s) ? 'inv_polearm_2h_mawnecromancerboss_d_01_darkblue' : 'spell_deathknight_festering_strike'),
      onResolve: (s) => {
        const scythe = scytheReady(s)
        if (scythe) {
          s.damage('Festering Scythe', SCYTHE_COEFF)
          s.applyAura('target', 'festering_scythe')
        } else {
          s.gain(20, 'festering_strike')
          s.damage('festering_strike', FESTERING_COEFF)
        }
        const charges = s.rng('festering_charges') < 0.5 ? 2 : 3
        s.applyAura('player', 'lesser_ghoul_ready', { stacks: charges })
      },
    },
    {
      // San'layn: becomes Vampiric Strike on proc, and for the whole Dark
      // Transformation window (Gift of the San'layn)
      id: 'scourge_strike',
      name: 'Scourge Strike',
      icon: 'spell_deathknight_scourgestrike',
      spellId: 55090,
      runeCost: 1,
      displayName: (s) => (vampReady(s) ? 'Vampiric Strike' : 'Scourge Strike'),
      displayIcon: (s) => (vampReady(s) ? 'inv_ability_sanlayndeathknight_vampiricstrike' : 'spell_deathknight_scourgestrike'),
      onResolve: (s) => {
        s.gain(10, 'scourge_strike')
        const vamp = vampReady(s)
        if (vamp) {
          if (!dtUp(s)) s.removeAura('player', 'vampiric_strike') // Gift: free inside DT
          s.damage('Vampiric Strike', VAMP_COEFF)
          s.applyAura('player', 'essence_of_the_blood_queen', { stacks: 1 })
          // Infliction of Sorrow: extend the plagues + burst a slice of them
          s.extendAura('target', 'virulent_plague', 3)
          s.extendAura('target', 'dread_plague', 3)
          s.damage('Infliction of Sorrow', INFLICTION_COEFF)
        } else {
          s.damage('scourge_strike', SCOURGE_COEFF)
        }
        // plagues erupt at 35%
        let erupt = 0
        if (s.auraRemains('target', 'virulent_plague') > 0) erupt += VP_TICK
        if (s.auraRemains('target', 'dread_plague') > 0) erupt += DP_TICK
        if (erupt > 0) s.damage('Plague Eruption', erupt * ERUPT_MULT)
        if (s.stacks('player', 'lesser_ghoul_ready') > 0) {
          s.consumeStack('player', 'lesser_ghoul_ready')
          summonGhoul(s)
        }
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
        // San'layn: Death Coil can proc Vampiric Strike (APPROX rate)
        if (s.rng('vampiric_strike') < VAMP_PROC) s.applyAura('player', 'vampiric_strike')
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
      },
    },
    {
      id: 'dark_transformation',
      name: 'Dark Transformation',
      icon: 'achievement_boss_festergutrotface',
      spellId: 1233448,
      cooldown: 45,
      offGcd: true,
      onResolve: (s) => {
        s.applyAura('player', 'dark_transformation')
        // Reaping: resets Soul Reaper and lets it be used at any health
        s.applyAura('player', 'reaping')
        s.resetCooldown('soul_reaper')
      },
    },
    {
      id: 'soul_reaper',
      name: 'Soul Reaper',
      icon: 'ability_deathknight_soulreaper',
      spellId: 343294,
      runeCost: 1,
      cooldown: 15,
      usable: (s) => (s.auraRemains('player', 'reaping') > 0
        ? true
        : 'needs a Reaping proc (target never drops below 35% here)'),
      onResolve: (s) => {
        s.gain(10, 'soul_reaper')
        s.removeAura('player', 'reaping')
        s.damage('soul_reaper', SOUL_REAPER_COEFF)
        s.applyAura('target', 'soul_reaper') // pets + diseases +20% for 5s
      },
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
      },
    },
    {
      id: 'putrefy',
      name: 'Putrefy',
      icon: 'inv12_ability_deathknight_putrefy',
      spellId: 1247378,
      runeCost: 1,
      cooldown: 30,
      charges: 3, // Putrid Echoes
      onResolve: (s) => {
        s.gain(10, 'putrefy')
        s.damage('putrefy', PUTREFY_COEFF * 1.2 * petMult(s)) // Putrid Echoes +20%
        summonMagus(s) // Lord of the Dead: putrefied ghouls reanimate as Magi
      },
    },
  ],

  actionBar: [
    'festering_strike', 'scourge_strike', 'death_coil', 'outbreak',
    'soul_reaper', 'putrefy', 'dark_transformation', 'army_of_the_dead',
  ],

  damageMult: (s, id, _tags) => {
    const plague = id === 'virulent_plague' || id === 'dread_plague'
      || id === 'Plague Eruption' || id === 'Infliction of Sorrow'
    const pet = id === 'Ghoul' || id === 'Lesser Ghoul' || id === 'Magus of the Dead'
      || id === 'Lord of the Dead' || id === 'Army of the Dead'
    let m = 1
    // Festering Scythe: faster disease ticks, modeled as bonus tick damage
    if (plague && s.auraRemains('target', 'festering_scythe') > 0) m *= 1.25
    // Soul Reaper debuff empowers pets and diseases briefly
    if ((plague || pet) && s.auraRemains('target', 'soul_reaper') > 0) m *= 1.2
    return m
  },

  // Essence of the Blood Queen: 1% haste per stack (APPROX), 80% more
  // effective while Dark Transformation runs (Gift of the San'layn)
  hasteMod: (s) => 0.01 * essence(s) * (dtUp(s) ? 1.8 : 1),

  glows: (s, id) => {
    switch (id) {
      case 'death_coil': return s.auraRemains('player', 'sudden_doom') > 0
      case 'scourge_strike': return vampReady(s)
      case 'festering_strike': return scytheReady(s)
      case 'soul_reaper': return s.auraRemains('player', 'reaping') > 0
      default: return false
    }
  },

  priorityList: [
    { abilityId: 'outbreak', text: 'Keep Virulent + Dread Plague up — Dread Plague drives Sudden Doom' },
    { abilityId: 'festering_strike', text: 'Before Dark Transformation at 3 or fewer Lesser Ghoul charges', when: s => s.cooldownRemains('dark_transformation') === 0 && s.stacks('player', 'lesser_ghoul_ready') <= 3 },
    { abilityId: 'army_of_the_dead', text: 'On cooldown — opens the 30s Forbidden Knowledge window', when: s => s.cooldownRemains('army_of_the_dead') === 0 },
    { abilityId: 'dark_transformation', text: 'On cooldown, off-GCD — Gift of the San\'layn: every Scourge Strike becomes Vampiric Strike', when: s => s.cooldownRemains('dark_transformation') === 0 },
    { abilityId: 'putrefy', text: 'At 2+ charges — never sit capped', when: s => s.chargesOf('putrefy') >= 2 },
    { abilityId: 'soul_reaper', text: 'On a Reaping proc (or under 35% target health on real targets)', when: s => s.auraRemains('player', 'reaping') > 0 },
    { abilityId: 'festering_strike', text: 'As Festering Scythe (free) whenever its disease buff is missing', label: 'Festering Scythe', icon: 'inv_polearm_2h_mawnecromancerboss_d_01_darkblue', when: s => scytheReady(s) },
    { abilityId: 'death_coil', text: 'Sudden Doom proc, 80+ Runic Power, or during Forbidden Knowledge (Necrotic Coil)', when: s => s.auraRemains('player', 'sudden_doom') > 0 || s.auraRemains('player', 'forbidden_knowledge') > 0 },
    { abilityId: 'putrefy', text: 'When Dark Transformation is 15s+ away', when: s => s.chargesOf('putrefy') > 0 && s.cooldownRemains('dark_transformation') >= 15 },
    { abilityId: 'scourge_strike', text: 'As Vampiric Strike below 7 Essence of the Blood Queen — stack to 7 in the window, bridge it between windows', label: 'Vampiric Strike', icon: 'inv_ability_sanlayndeathknight_vampiricstrike', when: s => vampReady(s) && s.stacks('player', 'essence_of_the_blood_queen') < 7 },
    { abilityId: 'death_coil', text: 'Dump Runic Power to fish Vampiric Strike procs when Essence is about to drop', when: s => s.stacks('player', 'essence_of_the_blood_queen') > 0 && s.auraRemains('player', 'essence_of_the_blood_queen') < 4 },
    { abilityId: 'festering_strike', text: 'At no Lesser Ghoul charges' },
    { abilityId: 'scourge_strike', text: 'Spend Lesser Ghoul charges (each = a pet ghoul)', when: s => s.stacks('player', 'lesser_ghoul_ready') > 0 },
    { abilityId: 'death_coil', text: 'Filler' },
  ],

  policy: (s) => {
    const rp = s.insanity
    const charges = s.stacks('player', 'lesser_ghoul_ready')
    const dtCd = s.cooldownRemains('dark_transformation')

    // plague upkeep first — Dread Plague drives Sudden Doom
    if (s.auraRemains('target', 'virulent_plague') <= 3 || s.auraRemains('target', 'dread_plague') <= 3) {
      if (s.isUsable('outbreak') === true) return 'outbreak'
    }
    // Method S1: Festering Strike before Dark Transformation at ≤3 charges
    if (dtCd === 0 && charges <= 3 && !scytheReady(s) && s.isUsable('festering_strike') === true) return 'festering_strike'
    if (s.isUsable('army_of_the_dead') === true && s.timeToUsable('army_of_the_dead') === 0) return 'army_of_the_dead'
    if (dtCd === 0) return 'dark_transformation'
    if (s.chargesOf('putrefy') >= 2 && 100 - rp > 10
      && s.isUsable('putrefy') === true && s.timeToUsable('putrefy') === 0) return 'putrefy'
    if (s.isUsable('soul_reaper') === true && s.timeToUsable('soul_reaper') === 0) return 'soul_reaper'
    if (scytheReady(s) && s.isUsable('festering_strike') === true) return 'festering_strike'
    if ((s.auraRemains('player', 'sudden_doom') > 0 || 100 - rp < 20
      || s.auraRemains('player', 'forbidden_knowledge') > 0)
      && s.isUsable('death_coil') === true) return 'death_coil'
    if (dtCd >= 15 && s.chargesOf('putrefy') > 0
      && s.isUsable('putrefy') === true && s.timeToUsable('putrefy') === 0) return 'putrefy'
    if (vampReady(s) && essence(s) < 7 && s.isUsable('scourge_strike') === true) return 'scourge_strike'
    // bridge Essence: dump RP for Vampiric Strike procs before it drops
    if (essence(s) > 0 && s.auraRemains('player', 'essence_of_the_blood_queen') < 4
      && !vampReady(s) && s.isUsable('death_coil') === true) return 'death_coil'
    if (charges === 0 && s.isUsable('festering_strike') === true) return 'festering_strike'
    if (charges >= 1 && s.isUsable('scourge_strike') === true) return 'scourge_strike'
    if (rp >= 30 && s.isUsable('death_coil') === true) return 'death_coil'
    return null // pooling runes
  },

  equivalentChoices: (_s, pressed, oracle) => {
    const strikes = ['scourge_strike', 'festering_strike']
    return strikes.includes(pressed) && strikes.includes(oracle)
  },
}
