import { useState } from 'react'
import type { ScoreReport } from './engine/score'
import type { SpecConfig } from './engine/types'
import { specs, specById } from './specs'
import { SpecPicker } from './ui/SpecPicker'
import { SetupScreen } from './ui/SetupScreen'
import { TrainingScreen } from './ui/TrainingScreen'
import { ReportScreen } from './ui/ReportScreen'

export interface TrainingConfig {
  duration: number
  seed: number
  keybinds: string[] // key combo per action-bar slot (keybinds stay with the slot)
  barOrder: string[] // ability id per slot (spells get dragged between slots)
  hastePct: number   // character-sheet haste, e.g. 15 = 15%
  critPct: number
  lustOnPull: boolean
  liveHints: boolean
}

const DEFAULT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal']

// per-spec storage keys; the original single-spec build wrote unprefixed keys,
// so shadow priest falls back to those
function storageKey(specId: string, what: string): string[] {
  const keys = [`rt-${specId}-${what}`]
  if (specId === 'priest-shadow') keys.push(`rt-${what}`)
  return keys
}

function readJson(keys: string[]): unknown {
  for (const k of keys) {
    try {
      const v = JSON.parse(localStorage.getItem(k) ?? 'null')
      if (v !== null) return v
    } catch { /* try next */ }
  }
  return null
}

function loadConfig(spec: SpecConfig): TrainingConfig {
  const slots = spec.actionBar.length
  const kb = readJson(storageKey(spec.specId, 'keybinds'))
  const keybinds = Array.isArray(kb) && kb.length >= slots ? kb.slice(0, slots) : DEFAULT_KEYS.slice(0, slots)
  const bo = readJson(storageKey(spec.specId, 'barorder'))
  const barOrder = Array.isArray(bo) && bo.length === slots && spec.actionBar.every(id => bo.includes(id))
    ? bo : spec.actionBar
  const defaults = { duration: 90, hastePct: 15, critPct: 20, lustOnPull: false, liveHints: false }
  const st = readJson(storageKey(spec.specId, 'settings'))
  const settings = st && typeof st === 'object' ? { ...defaults, ...st } : defaults
  return { seed: 1, keybinds, barOrder, ...settings }
}

export default function App() {
  const [specId, setSpecId] = useState<string | null>(() => {
    const saved = localStorage.getItem('rt-spec')
    return saved && specById(saved) ? saved : (specs.length === 1 ? specs[0].specId : null)
  })
  const spec = specId ? specById(specId) ?? null : null
  const [screen, setScreen] = useState<'setup' | 'training' | 'report'>('setup')
  const [config, setConfig] = useState<TrainingConfig | null>(() => (spec ? loadConfig(spec) : null))
  const [report, setReport] = useState<ScoreReport | null>(null)

  const pickSpec = (id: string) => {
    const s = specById(id)!
    localStorage.setItem('rt-spec', id)
    setSpecId(id)
    setConfig(loadConfig(s))
    setReport(null)
    setScreen('setup')
  }

  const startTraining = (cfg: TrainingConfig) => {
    if (!spec) return
    localStorage.setItem(storageKey(spec.specId, 'keybinds')[0], JSON.stringify(cfg.keybinds))
    localStorage.setItem(storageKey(spec.specId, 'barorder')[0], JSON.stringify(cfg.barOrder))
    localStorage.setItem(storageKey(spec.specId, 'settings')[0], JSON.stringify({
      duration: cfg.duration, hastePct: cfg.hastePct, critPct: cfg.critPct,
      lustOnPull: cfg.lustOnPull, liveHints: cfg.liveHints,
    }))
    setConfig({ ...cfg, seed: Math.floor(Math.random() * 1e9) })
    setScreen('training')
  }

  if (!spec || !config) {
    return <div className="app"><SpecPicker onPick={pickSpec} /></div>
  }

  return (
    <div className="app">
      {screen === 'setup' && (
        <SetupScreen
          spec={spec} config={config} onStart={startTraining} lastReport={report}
          onChangeSpec={() => { localStorage.removeItem('rt-spec'); setSpecId(null); setConfig(null) }}
        />
      )}
      {screen === 'training' && (
        <TrainingScreen
          spec={spec}
          config={config}
          onFinish={r => { setReport(r); setScreen('report') }}
          onAbort={() => setScreen('setup')}
        />
      )}
      {screen === 'report' && report && (
        <ReportScreen spec={spec} report={report} onAgain={() => setScreen('training')} onSetup={() => setScreen('setup')} />
      )}
    </div>
  )
}
