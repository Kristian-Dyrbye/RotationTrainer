import type { Sim } from './sim'

export type CastGrade = 'perfect' | 'good' | 'miss'

export interface GradedCast {
  time: number
  abilityId: string
  oracleChoice: string | null
  grade: CastGrade
  deadTime: number
  insanityBefore: number
}

export interface ScoreReport {
  /** the headline 0–100 */
  score: number
  playerDps: number
  oracleDps: number
  /** % of graded casts matching the oracle (perfect or good) */
  decisionAccuracy: number
  /** fraction of the fight the GCD was actually in use */
  uptime: number
  wastedInsanity: number
  totalCasts: number
  perfectCasts: number
  goodCasts: number
  missCasts: number
  totalDeadTime: number
  casts: GradedCast[]
  damageBySpell: { spellId: string; total: number; casts: number }[]
}

export function buildReport(player: Sim, oracle: Sim): ScoreReport {
  const duration = player.config.duration
  const spec = player.spec

  const casts: GradedCast[] = player.castLog.map(c => {
    let grade: CastGrade
    if (!c.oracleChoice || c.abilityId === c.oracleChoice) {
      grade = 'perfect'
    } else if (spec.equivalentChoices?.(player, c.abilityId, c.oracleChoice)) {
      grade = 'good'
    } else {
      grade = 'miss'
    }
    return {
      time: c.time,
      abilityId: c.abilityId,
      oracleChoice: c.oracleChoice,
      grade,
      deadTime: c.deadTime,
      insanityBefore: c.insanityBefore,
    }
  })

  const perfect = casts.filter(c => c.grade === 'perfect').length
  const good = casts.filter(c => c.grade === 'good').length
  const miss = casts.filter(c => c.grade === 'miss').length
  const totalDeadTime = casts.reduce((s, c) => s + Math.min(c.deadTime, 10), 0)

  const playerDps = player.totalDamage / duration
  const oracleDps = oracle.totalDamage / duration
  const score = Math.round(100 * Math.min(1, oracleDps > 0 ? playerDps / oracleDps : 0))

  const bySpell = new Map<string, { total: number; casts: number }>()
  for (const d of player.damageLog) {
    const e = bySpell.get(d.spellId) ?? { total: 0, casts: 0 }
    e.total += d.amount
    e.casts += 1
    bySpell.set(d.spellId, e)
  }

  return {
    score,
    playerDps,
    oracleDps,
    decisionAccuracy: casts.length ? (perfect + good) / casts.length : 0,
    uptime: Math.max(0, 1 - totalDeadTime / duration),
    wastedInsanity: player.wastedInsanity,
    totalCasts: casts.length,
    perfectCasts: perfect,
    goodCasts: good,
    missCasts: miss,
    totalDeadTime,
    casts,
    damageBySpell: [...bySpell.entries()]
      .map(([spellId, v]) => ({ spellId, ...v }))
      .sort((a, b) => b.total - a.total),
  }
}
