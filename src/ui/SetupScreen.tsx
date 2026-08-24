import { useEffect, useState } from 'react'
import type { SpecConfig } from '../engine/types'
import type { ScoreReport } from '../engine/score'
import type { TrainingConfig } from '../App'
import { buildIdOf } from '../specs'
import { iconUrl } from './icons'
import { comboFromEvent, useKeyLabels } from './keys'
import { PriorityPanel } from './PriorityPanel'

export function SetupScreen({ spec, config, onStart, lastReport, onChangeSpec, variants, onChangeBuild }: {
  spec: SpecConfig
  config: TrainingConfig
  onStart: (cfg: TrainingConfig) => void
  lastReport: ScoreReport | null
  onChangeSpec: () => void
  variants: SpecConfig[]
  onChangeBuild: (buildId: string) => void
}) {
  const [duration, setDuration] = useState(config.duration)
  const [keybinds, setKeybinds] = useState(config.keybinds)
  const [barOrder, setBarOrder] = useState(config.barOrder)
  const [hastePct, setHastePct] = useState(config.hastePct)
  const [critPct, setCritPct] = useState(config.critPct)
  const [lustOnPull, setLustOnPull] = useState(config.lustOnPull)
  const [liveHints, setLiveHints] = useState(config.liveHints)
  const [binding, setBinding] = useState<number | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [showIntro, setShowIntro] = useState(() => {
    try { return localStorage.getItem('rt-intro-dismissed') !== '1' } catch { return true }
  })
  const keyLabel = useKeyLabels()

  const dismissIntro = () => {
    try { localStorage.setItem('rt-intro-dismissed', '1') } catch { /* private mode */ }
    setShowIntro(false)
  }

  // while a slot is armed, the next non-modifier keypress (with any Ctrl/Alt/Shift held) binds it
  useEffect(() => {
    if (binding === null) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setBinding(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return // just a modifier — keep waiting for the full combo
      setKeybinds(kb => kb.map((k, i) => (i === binding ? combo : k)))
      setBinding(null)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [binding])

  const dropOn = (target: number) => {
    if (dragFrom === null || dragFrom === target) { setDragFrom(null); return }
    setBarOrder(order => {
      const next = [...order]
      ;[next[dragFrom], next[target]] = [next[target], next[dragFrom]]
      return next
    })
    setDragFrom(null)
  }

  const clampPct = (v: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(v) ? v : 0))

  return (
    <div className="setup with-sidebar">
      <PriorityPanel spec={spec} />
      <div>
        <header className="setup-head">
          <div className="spec-badge">
            <img src={iconUrl(spec.specIcon ?? 'inv_misc_questionmark')} alt="" />
            <div>
              <h1>{spec.name}{spec.source ? ` — ${spec.source.heroTalent}` : ''}</h1>
              <p className="sub">Rotation Trainer · patch 12.1.0 · single-target dummy</p>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <button className="chip" onClick={() => setShowIntro(v => !v)}>How it works</button>
              <button className="chip" onClick={onChangeSpec}>Change spec</button>
            </div>
          </div>
        </header>

        {showIntro && (
          <section className="panel intro-panel">
            <h2>Welcome — how the trainer works</h2>
            <ol className="intro-steps">
              <li>
                <strong>Learn the rotation.</strong> The sidebar on the left is this spec's priority list —
                the same logic the scoring oracle plays. Read it top to bottom: the first matching row is
                the right button to press.
              </li>
              <li>
                <strong>Set up your bar.</strong> Drag spells between slots to mirror your in-game layout —
                keybinds stay with the slot, exactly like in game. Click a slot, then press any key or
                combo (Shift+1, Ctrl+Q, …) to rebind it.
              </li>
              <li>
                <strong>Match your character.</strong> Enter Haste and Crit from your character sheet.
                They drive the sim for real: cast speed, resource generation, and proc rates all scale —
                for you and the oracle alike, so the score stays fair.
              </li>
              <li>
                <strong>Train.</strong> Pick a fight length and press <em>Enter Combat</em> — the dummy
                fight starts on your first keypress. Watch for glowing buttons: those are procs asking to
                be spent. Turn on <em>Live hints</em> if you want the trainer to highlight the oracle's
                next press while you learn.
              </li>
              <li>
                <strong>Read your debrief.</strong> Afterwards you get a 0–100 score against the oracle on
                the same procs and RNG, plus a per-cast Perfect/Good/Miss timeline, dead-GCD time, and
                resource waste — the fastest fixes usually hide in the Miss rows.
              </li>
            </ol>
            <div className="row">
              <button className="chip active" onClick={dismissIntro}>Got it — don't show this again</button>
            </div>
          </section>
        )}

        {spec.source && (
          <section className="panel">
            <h2>Build — from Wowhead</h2>
            {variants.length > 1 && (
              <div className="row" style={{ marginBottom: '0.6rem' }}>
                {variants.map(v => (
                  <button
                    key={buildIdOf(v)}
                    className={`chip ${v === spec ? 'active' : ''}`}
                    onClick={() => v !== spec && onChangeBuild(buildIdOf(v))}
                    title={v.source?.buildName}
                  >
                    {v.source?.heroTalent ?? buildIdOf(v)}
                  </button>
                ))}
                <span className="hint">Switching swaps the action bar, rotation and scoring oracle.</span>
              </div>
            )}
            <p>
              <strong>{spec.source.buildName}</strong> · {spec.source.heroTalent} hero talents
              {' · '}
              <a href={spec.source.guideUrl} target="_blank" rel="noreferrer">Open the Wowhead guide ↗</a>
            </p>
            <p className="hint">
              The rotation in the sidebar mirrors this guide's single-target priority
              (verified {spec.source.retrieved}). Set your character up with the same build for the
              trainer to match the game.
            </p>
            {spec.source.talentString && (
              <div className="row">
                <button
                  className="chip"
                  onClick={() => {
                    navigator.clipboard?.writeText(spec.source!.talentString!).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    })
                  }}
                >
                  {copied ? 'Copied!' : 'Copy talent import string'}
                </button>
                <span className="hint">Paste it in the in-game talent frame (Import Loadout).</span>
              </div>
            )}
          </section>
        )}

        <section className="panel">
          <h2>Action bar &amp; keybinds</h2>
          <p className="hint">
            <strong>Drag spells</strong> to rearrange the bar — keybinds stay with the slot, like in game.
            <strong> Click</strong> a slot, then press a key to rebind it — Shift / Ctrl / Alt combos work (e.g. Shift+1).
            Labels follow your keyboard layout. Esc cancels a rebind.
          </p>
          <div className="bar setup-bar">
            {barOrder.map((abilityId, i) => {
              const a = spec.abilities.find(x => x.id === abilityId)!
              return (
                <button
                  key={abilityId}
                  className={`slot ${binding === i ? 'binding' : ''} ${dragFrom === i ? 'dragging' : ''}`}
                  onClick={() => setBinding(binding === i ? null : i)}
                  draggable
                  onDragStart={e => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); dropOn(i) }}
                  onDragEnd={() => setDragFrom(null)}
                  title={`${a.name} — drag to move, click to rebind`}
                >
                  <img src={iconUrl(a.icon)} alt={a.name} draggable={false} />
                  <span className="keybind">{binding === i ? 'press key…' : keyLabel(keybinds[i])}</span>
                  <span className="slot-name">{a.name}</span>
                </button>
              )
            })}
          </div>
          <div className="row">
            {binding !== null ? (
              <p className="hint bind-note">Press the key (or key combo) for <strong>{spec.abilities.find(x => x.id === barOrder[binding])?.name}</strong>…</p>
            ) : (
              <button className="chip" onClick={() => setBarOrder(spec.actionBar)}>Reset layout</button>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Character</h2>
          <div className="row">
            <label>Haste</label>
            <input
              className="stat-input mono" type="number" min={0} max={100} step={0.1}
              value={hastePct}
              onChange={e => setHastePct(clampPct(parseFloat(e.target.value), 100))}
            />
            <span className="hint">%</span>
            <label style={{ marginLeft: '1rem' }}>Crit</label>
            <input
              className="stat-input mono" type="number" min={0} max={100} step={0.1}
              value={critPct}
              onChange={e => setCritPct(clampPct(parseFloat(e.target.value), 100))}
            />
            <span className="hint">%</span>
          </div>
          <p className="hint">Enter the values from your character sheet — GCD, cast/channel speed, and DoT ticks all scale with haste, for you and for the oracle alike.</p>
        </section>

        <section className="panel">
          <h2>Session</h2>
          <div className="row">
            <label>Fight length</label>
            {[60, 90, 120, 180].map(d => (
              <button key={d} className={`chip ${duration === d ? 'active' : ''}`} onClick={() => setDuration(d)}>{d}s</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button className={`chip ${lustOnPull ? 'active' : ''}`} onClick={() => setLustOnPull(v => !v)}>
              Bloodlust on pull (+30% haste, 40s)
            </button>
            <button className={`chip ${liveHints ? 'active' : ''}`} onClick={() => setLiveHints(v => !v)}>
              Live hints (highlight the next press)
            </button>
          </div>
        </section>

        {lastReport && (
          <section className="panel">
            <h2>Last run</h2>
            <p>Score <strong className="gold">{lastReport.score}</strong> · {Math.round(lastReport.decisionAccuracy * 100)}% correct decisions · {lastReport.totalDeadTime.toFixed(1)}s dead time</p>
          </section>
        )}

        <button
          className="start-btn"
          onClick={() => onStart({ ...config, duration, keybinds, barOrder, hastePct, critPct, lustOnPull, liveHints })}
        >
          Enter Combat
        </button>
        <p className="hint center">The fight starts on your first keypress.</p>
      </div>
    </div>
  )
}
