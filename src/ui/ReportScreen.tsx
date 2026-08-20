import type { ScoreReport } from '../engine/score'
import type { SpecConfig } from '../engine/types'
import { iconUrl } from './icons'

function scoreColor(score: number): string {
  if (score >= 90) return 'var(--epic)'
  if (score >= 75) return 'var(--rare)'
  if (score >= 50) return 'var(--uncommon)'
  return 'var(--poor)'
}

export function ReportScreen({ spec, report, onAgain, onSetup }: {
  spec: SpecConfig
  report: ScoreReport
  onAgain: () => void
  onSetup: () => void
}) {
  const abilityName = (id: string | null) =>
    id ? (spec.abilities.find(a => a.id === id)?.name ?? id) : '—'
  const abilityIcon = (id: string) => spec.abilities.find(a => a.id === id)?.icon

  return (
    <div className="report">
      <div className="score-hero">
        <div className="score-dial" style={{ color: scoreColor(report.score) }}>
          <span className="score-num">{report.score}</span>
          <span className="score-max">/ 100</span>
        </div>
        <div className="score-sub">
          <p>
            You dealt <strong>{report.playerDps.toFixed(1)}</strong> dmg/s.
            The oracle, on the same procs, dealt <strong>{report.oracleDps.toFixed(1)}</strong>.
          </p>
        </div>
      </div>

      <div className="subscores">
        <div className="subscore">
          <span className="k">Decision accuracy</span>
          <span className="v mono">{Math.round(report.decisionAccuracy * 100)}%</span>
          <span className="d">{report.perfectCasts} perfect · {report.goodCasts} good · {report.missCasts} off-priority</span>
        </div>
        <div className="subscore">
          <span className="k">Uptime</span>
          <span className="v mono">{Math.round(report.uptime * 100)}%</span>
          <span className="d">{report.totalDeadTime.toFixed(1)}s of dead GCD time</span>
        </div>
        <div className="subscore">
          <span className="k">{spec.resourceName} wasted</span>
          <span className="v mono">{Math.round(report.wastedInsanity)}</span>
          <span className="d">generated past the cap</span>
        </div>
        <div className="subscore">
          <span className="k">Casts</span>
          <span className="v mono">{report.totalCasts}</span>
          <span className="d">in the full fight</span>
        </div>
      </div>

      <div className="report-cols">
        <div className="report-left">
        <section className="panel">
          <h2>Damage by spell</h2>
          <table className="dmg-table">
            <tbody>
              {report.damageBySpell.slice(0, 10).map(d => {
                const max = report.damageBySpell[0].total
                const def = spec.abilities.find(a => a.id === d.spellId)
                const aura = spec.auras.find(a => a.id === d.spellId)
                const label = def?.name ?? aura?.name ?? d.spellId
                const icon = def?.icon ?? aura?.icon
                return (
                  <tr key={d.spellId}>
                    <td className="dmg-name">{icon && <img src={iconUrl(icon, 'medium')} alt="" />}{label}</td>
                    <td className="dmg-bar"><div style={{ width: `${(d.total / max) * 100}%` }} /></td>
                    <td className="mono dmg-val">{d.total.toFixed(0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>DoT uptime</h2>
          {report.dotUptimes.map(d => (
            <div key={d.id} className="uptime-row">
              <span className="dmg-name">{d.icon && <img src={iconUrl(d.icon, 'medium')} alt="" />}{d.name}</span>
              <div className="uptime-bars">
                <div className="uptime-bar you" title="you">
                  <div style={{ width: `${d.uptime * 100}%` }} />
                  <span className="mono">{Math.round(d.uptime * 100)}%</span>
                </div>
                <div className="uptime-bar oracle" title="oracle">
                  <div style={{ width: `${d.oracleUptime * 100}%` }} />
                  <span className="mono">{Math.round(d.oracleUptime * 100)}% oracle</span>
                </div>
              </div>
            </div>
          ))}
        </section>
        </div>

        <section className="panel timeline-panel">
          <h2>Cast timeline</h2>
          <div className="timeline">
            {report.casts.map((c, i) => (
              <div key={i} className={`cast-row ${c.grade}`}>
                <span className="mono t">{c.time.toFixed(1)}s</span>
                {abilityIcon(c.abilityId) && <img src={iconUrl(abilityIcon(c.abilityId)!, 'medium')} alt="" />}
                <span className="cast-name">{abilityName(c.abilityId)}</span>
                <span className={`grade-pill ${c.grade}`}>
                  {c.grade === 'perfect' ? '✓' : c.grade === 'good' ? '≈' : '✗'}
                </span>
                <span className="why">
                  {c.grade === 'miss' && <>oracle: {abilityName(c.oracleChoice)}</>}
                  {c.deadTime > 0.35 && <span className="dead"> +{c.deadTime.toFixed(1)}s idle</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="report-actions">
        <button className="start-btn" onClick={onAgain}>Go again</button>
        <button className="chip" onClick={onSetup}>Back to setup</button>
      </div>
    </div>
  )
}
