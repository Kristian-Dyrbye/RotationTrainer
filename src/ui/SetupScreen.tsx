import { useState } from 'react'
import type { SpecConfig } from '../engine/types'
import type { ScoreReport } from '../engine/score'
import type { TrainingConfig } from '../App'
import { iconUrl } from './icons'

export function keyLabel(code: string): string {
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Key')) return code.slice(3)
  const map: Record<string, string> = {
    Minus: '-', Equal: '=', Space: 'SPC', ShiftLeft: 'LSh', ControlLeft: 'LCt',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  }
  return map[code] ?? code
}

export function SetupScreen({ spec, config, onStart, lastReport }: {
  spec: SpecConfig
  config: TrainingConfig
  onStart: (cfg: TrainingConfig) => void
  lastReport: ScoreReport | null
}) {
  const [duration, setDuration] = useState(config.duration)
  const [keybinds, setKeybinds] = useState(config.keybinds)
  const [binding, setBinding] = useState<number | null>(null)

  const bindKey = (slot: number) => {
    setBinding(slot)
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.code !== 'Escape') {
        setKeybinds(kb => kb.map((k, i) => (i === slot ? e.code : k)))
      }
      setBinding(null)
      window.removeEventListener('keydown', handler, true)
    }
    window.addEventListener('keydown', handler, true)
  }

  return (
    <div className="setup">
      <header className="setup-head">
        <div className="spec-badge">
          <img src={iconUrl('spell_shadow_shadowform')} alt="" />
          <div>
            <h1>{spec.name}</h1>
            <p className="sub">Rotation Trainer · patch 12.1.0 · single-target dummy</p>
          </div>
        </div>
      </header>

      <section className="panel">
        <h2>Action bar &amp; keybinds</h2>
        <p className="hint">Click a slot, then press the key you use in game. The order matches the recommended layout — abilities work from any slot.</p>
        <div className="bar setup-bar">
          {spec.actionBar.map((abilityId, i) => {
            const a = spec.abilities.find(x => x.id === abilityId)!
            return (
              <button
                key={abilityId}
                className={`slot ${binding === i ? 'binding' : ''}`}
                onClick={() => bindKey(i)}
                title={a.name}
              >
                <img src={iconUrl(a.icon)} alt={a.name} draggable={false} />
                <span className="keybind">{binding === i ? '…' : keyLabel(keybinds[i])}</span>
                <span className="slot-name">{a.name}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel">
        <h2>Session</h2>
        <div className="row">
          <label>Fight length</label>
          {[60, 90, 120, 180].map(d => (
            <button key={d} className={`chip ${duration === d ? 'active' : ''}`} onClick={() => setDuration(d)}>{d}s</button>
          ))}
        </div>
      </section>

      {lastReport && (
        <section className="panel">
          <h2>Last run</h2>
          <p>Score <strong className="gold">{lastReport.score}</strong> · {Math.round(lastReport.decisionAccuracy * 100)}% correct decisions · {lastReport.totalDeadTime.toFixed(1)}s dead time</p>
        </section>
      )}

      <button className="start-btn" onClick={() => onStart({ ...config, duration, keybinds })}>
        Enter Combat
      </button>
      <p className="hint center">The fight starts on your first keypress.</p>
    </div>
  )
}
