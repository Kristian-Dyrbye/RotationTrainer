import { describe, expect, it } from 'vitest'
import { Sim, runOracle } from '../engine/sim'
import { buildReport } from '../engine/score'
import { specs } from './index'

const STATS = { haste: 0.15, critChance: 0.2, critMult: 2.0 }
const CFG = { seed: 77, duration: 120, stats: STATS }

// every registered spec must pass the same conformance battery
for (const spec of specs) {
  describe(`${spec.name} conformance`, () => {
    it('oracle completes a 2-minute fight with a full kit', () => {
      const sim = runOracle(spec, CFG)
      expect(sim.time).toBeGreaterThanOrEqual(120)
      expect(sim.totalDamage).toBeGreaterThan(0)
      expect(sim.castLog.length === 0 || sim.castLog.length > 30).toBe(true)
      const used = new Set(sim.damageLog.map(d => d.spellId))
      expect(used.size).toBeGreaterThanOrEqual(5)
    })

    it('is deterministic per seed', () => {
      const a = runOracle(spec, CFG)
      const b = runOracle(spec, CFG)
      expect(a.totalDamage).toBe(b.totalDamage)
      expect(a.damageLog.length).toBe(b.damageLog.length)
    })

    it('keeps its DoTs rolling', () => {
      const sim = runOracle(spec, CFG)
      const dots = spec.auras.filter(a => a.debuff && a.tick)
      if (!dots.length) return
      const uptimes = dots.map(d => sim.debuffUptime(d.id) / CFG.duration)
      expect(Math.max(...uptimes)).toBeGreaterThan(0.75)
      for (let i = 0; i < dots.length; i++) {
        expect(uptimes[i], dots[i].id).toBeGreaterThan(0.45)
      }
    })

    it('scores ~perfect when the oracle policy replays through the player path', () => {
      const oracle = runOracle(spec, CFG)
      const player = new Sim(spec, CFG)
      player.beginCombat()
      let guard = 0
      while (player.time < CFG.duration && guard++ < 200000) {
        if (player.isReady()) {
          const choice = spec.policy(player)
          if (choice && player.isUsable(choice) === true) {
            player.press(choice)
            continue
          }
        }
        player.advance(Math.min(CFG.duration, player.time + 0.05))
      }
      const report = buildReport(player, oracle)
      expect(report.score).toBeGreaterThanOrEqual(95)
      expect(report.decisionAccuracy).toBeGreaterThan(0.95)
    })

    it('has a priority list and matching action bar entries', () => {
      expect(spec.priorityList?.length ?? 0).toBeGreaterThan(4)
      for (const row of spec.priorityList ?? []) {
        expect(spec.actionBar, row.abilityId).toContain(row.abilityId)
      }
      for (const id of spec.actionBar) {
        expect(spec.abilities.some(a => a.id === id), id).toBe(true)
      }
    })
  })
}
