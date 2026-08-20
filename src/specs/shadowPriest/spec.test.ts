import { describe, expect, it } from 'vitest'
import { Sim, runOracle } from '../../engine/sim'
import { buildReport } from '../../engine/score'
import { shadowPriest } from './spec'

const STATS = { haste: 0.15, critChance: 0.2, critMult: 2.0 }
const CFG = { seed: 123, duration: 120, stats: STATS }

describe('shadow priest oracle', () => {
  it('completes a 2-minute fight with sensible output', () => {
    const sim = runOracle(shadowPriest, CFG)
    expect(sim.totalDamage).toBeGreaterThan(0)
    expect(sim.time).toBeGreaterThanOrEqual(120)
    // the oracle should barely waste any insanity
    expect(sim.wastedInsanity).toBeLessThan(30)
  })

  it('keeps both DoTs at high uptime', () => {
    const sim = runOracle(shadowPriest, CFG)
    for (const dot of ['swp_dot', 'vt_dot']) {
      const ticks = sim.damageLog.filter(d => d.spellId === dot).length
      // hasted swp ticks every ~1.74s, vt every ~2.6s; require >70% uptime worth
      const minTicks = dot === 'swp_dot' ? (120 / 1.74) * 0.7 : (120 / 2.6) * 0.7
      expect(ticks, dot).toBeGreaterThan(minTicks)
    }
  })

  it('uses the full kit', () => {
    const sim = runOracle(shadowPriest, CFG)
    const used = new Set(sim.damageLog.map(d => d.spellId))
    for (const id of ['mind_blast', 'shadow_word_madness', 'void_volley', 'tentacle_slam', 'halo', 'mind_flay', 'Shadowy Apparition']) {
      expect(used.has(id), id).toBe(true)
    }
  })

  it('is deterministic per seed', () => {
    const a = runOracle(shadowPriest, CFG)
    const b = runOracle(shadowPriest, CFG)
    expect(a.totalDamage).toBe(b.totalDamage)
  })
})

describe('shadow priest mechanics', () => {
  it('shadowy insight makes mind blast instant without consuming a charge', () => {
    const sim = new Sim(shadowPriest, CFG)
    sim.gradeCasts = false
    sim.beginCombat()
    const before = sim.chargesOf('mind_blast')
    sim.applyAura('player', 'shadowy_insight')
    expect(sim.press('mind_blast')).toBe('cast')
    expect(sim.totalDamage).toBeGreaterThan(0) // resolved instantly
    expect(sim.chargesOf('mind_blast')).toBe(before)
    expect(sim.stacks('player', 'shadowy_insight')).toBe(0)
  })

  it('mind devourer makes madness free', () => {
    const sim = new Sim(shadowPriest, CFG)
    sim.gradeCasts = false
    sim.beginCombat()
    expect(sim.press('shadow_word_madness')).toMatch(/not enough/)
    sim.applyAura('player', 'mind_devourer')
    expect(sim.press('shadow_word_madness')).toBe('cast')
    expect(sim.insanity).toBe(0)
    expect(sim.stacks('player', 'mind_devourer')).toBe(0)
  })

  it('voidform grants void volley charges and buffs damage', () => {
    const sim = new Sim(shadowPriest, CFG)
    sim.gradeCasts = false
    sim.beginCombat()
    expect(sim.press('void_volley')).toMatch(/needs a Void Volley charge/)
    sim.press('voidform')
    sim.advance(1.5)
    expect(sim.stacks('player', 'void_volley_charge')).toBe(3)
    expect(sim.auraRemains('player', 'voidform')).toBeGreaterThan(18)
    sim.advance(3)
    expect(sim.press('void_volley')).toBe('cast')
    expect(sim.stacks('player', 'void_volley_charge')).toBe(2)
    expect(sim.insanity).toBeGreaterThanOrEqual(10)
  })

  it('tentacle slam applies vampiric touch and a 4pc volley charge', () => {
    const sim = new Sim(shadowPriest, CFG)
    sim.gradeCasts = false
    sim.beginCombat()
    sim.press('tentacle_slam')
    expect(sim.auraRemains('target', 'vt_dot')).toBeCloseTo(21, 1)
    expect(sim.stacks('player', 'void_volley_charge')).toBe(1)
    expect(sim.insanity).toBe(6)
  })

  it('madness rollover never clips remaining duration', () => {
    const sim = new Sim(shadowPriest, CFG)
    sim.gradeCasts = false
    sim.beginCombat()
    sim.insanity = 100
    sim.press('shadow_word_madness')
    sim.advance(2)
    sim.insanity = 100
    sim.press('shadow_word_madness') // 4s remaining -> 6 + 4
    expect(sim.auraRemains('target', 'swm_dot')).toBeCloseTo(10, 1)
  })

  it('power infusion casts off-GCD, even mid-cast and mid-GCD', () => {
    const sim = new Sim(shadowPriest, CFG)
    sim.gradeCasts = false
    sim.beginCombat()
    sim.press('shadow_word_pain') // starts the GCD
    expect(sim.press('power_infusion')).toBe('cast') // ignores GCD
    expect(sim.auraRemains('player', 'power_infusion')).toBeCloseTo(15, 1)
    expect(sim.cooldownRemains('power_infusion')).toBeCloseTo(120, 1)

    const sim2 = new Sim(shadowPriest, CFG)
    sim2.gradeCasts = false
    sim2.beginCombat()
    sim2.press('vampiric_touch') // 1.5s hardcast in progress
    expect(sim2.press('power_infusion')).toBe('cast') // ignores the cast too
    expect(sim2.auraRemains('player', 'power_infusion')).toBeGreaterThan(0)
    sim2.advance(2)
    expect(sim2.auraRemains('target', 'vt_dot')).toBeGreaterThan(0) // cast not interrupted
  })

  it('scoring a replayed oracle run lands near 100', () => {
    // drive a player sim with the oracle policy — should be ~perfect
    const oracle = runOracle(shadowPriest, CFG)
    const player = new Sim(shadowPriest, CFG)
    player.beginCombat()
    let guard = 0
    while (player.time < CFG.duration && guard++ < 100000) {
      if (player.isReady()) {
        const choice = shadowPriest.policy(player)
        if (choice && player.isUsable(choice) === true) {
          player.press(choice)
          continue
        }
      }
      player.advance(Math.min(CFG.duration, player.time + 0.05))
    }
    const report = buildReport(player, oracle)
    expect(report.score).toBeGreaterThanOrEqual(97)
    expect(report.decisionAccuracy).toBeGreaterThan(0.97)
  })
})
