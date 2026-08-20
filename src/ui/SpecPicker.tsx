import { specs } from '../specs'
import { iconUrl } from './icons'

export function SpecPicker({ onPick }: { onPick: (specId: string) => void }) {
  return (
    <div className="picker">
      <header className="setup-head">
        <h1>Rotation Trainer</h1>
        <p className="sub hint">patch 12.1.0 · pick your spec</p>
      </header>
      <div className="spec-grid">
        {specs.map(s => (
          <button key={s.specId} className="spec-card" onClick={() => onPick(s.specId)}>
            <img src={iconUrl(s.specIcon ?? 'inv_misc_questionmark')} alt="" />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <p className="hint center">More specs are added as they're modeled — each is hand-built against live 12.1 data.</p>
    </div>
  )
}
