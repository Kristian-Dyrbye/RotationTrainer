import type { Sim } from '../engine/sim'
import type { SpecConfig } from '../engine/types'
import { iconUrl } from './icons'

/**
 * The spec's priority order. With `live` and a running sim, the row the oracle
 * would press right now is highlighted.
 */
export function PriorityPanel({ spec, sim, live }: {
  spec: SpecConfig
  sim?: Sim | null
  live?: boolean
}) {
  const rows = spec.priorityList ?? []
  let hl = -1
  if (live && sim && sim.combatStarted) {
    const choice = spec.policy(sim)
    if (choice) {
      hl = rows.findIndex(r => r.abilityId === choice && (r.when ? r.when(sim) : true))
      if (hl < 0) hl = rows.findIndex(r => r.abilityId === choice)
    }
  }
  return (
    <aside className="prio-panel">
      <h2>Priority</h2>
      <ol className="prio-list">
        {rows.map((r, i) => {
          const a = spec.abilities.find(x => x.id === r.abilityId)
          const icon = r.icon ?? a?.icon
          return (
            <li key={i} className={`prio-row ${hl === i ? 'hl' : ''}`}>
              {icon && <img src={iconUrl(icon, 'medium')} alt="" />}
              <div>
                <span className="prio-name">{r.label ?? a?.name ?? r.abilityId}</span>
                <span className="prio-cond">{r.text}</span>
              </div>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
