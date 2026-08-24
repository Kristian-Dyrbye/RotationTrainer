import { useState } from 'react'
import type { ScoreReport } from './engine/score'
import type { SpecConfig } from './engine/types'
import { specs, specById, specVariants, buildIdOf } from './specs'
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

// per-spec/per-build storage keys; the default build keeps the legacy per-spec
// keys (and shadow priest additionally the original unprefixed ones)
function storageKey(spec: SpecConfig, what: string): string[] {
  const isDefault = specVariants(spec.specId)[0] === spec
  const base = isDefault ? spec.specId : `${spec.specId}--${buildIdOf(spec)}`
  const keys = [`rt-${base}-${what}`]
  if (spec.specId === 'priest-shadow' && isDefault) keys.push(`rt-${what}`)
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
  const kb = readJson(storageKey(spec, 'keybinds'))
  const keybinds = Array.isArray(kb) && kb.length >= slots ? kb.slice(0, slots) : DEFAULT_KEYS.slice(0, slots)
  const bo = readJson(storageKey(spec, 'barorder'))
  const barOrder = Array.isArray(bo) && bo.length === slots && spec.actionBar.every(id => bo.includes(id))
    ? bo : spec.actionBar
  const defaults = { duration: 90, hastePct: 15, critPct: 20, lustOnPull: false, liveHints: false }
  const st = readJson(storageKey(spec, 'settings'))
  const settings = st && typeof st === 'object' ? { ...defaults, ...st } : defaults
  return { seed: 1, keybinds, barOrder, ...settings }
}

export default function App() {
  const [specId, setSpecId] = useState<string | null>(() => {
    const saved = localStorage.getItem('rt-spec')
    return saved && specById(saved) ? saved : (specs.length === 1 ? specs[0].specId : null)
  })
  const [buildId, setBuildId] = useState<string | null>(() => {
    const saved = localStorage.getItem('rt-spec')
    return saved ? localStorage.getItem(`rt-${saved}-build`) : null
  })
  const spec = specId ? specById(specId, buildId ?? undefined) ?? null : null
  const [screen, setScreen] = useState<'setup' | 'training' | 'report'>('setup')
  const [config, setConfig] = useState<TrainingConfig | null>(() => (spec ? loadConfig(spec) : null))
  const [report, setReport] = useState<ScoreReport | null>(null)

  const pickSpec = (id: string) => {
    const b = localStorage.getItem(`rt-${id}-build`)
    const s = specById(id, b ?? undefined)!
    localStorage.setItem('rt-spec', id)
    setSpecId(id)
    setBuildId(b)
    setConfig(loadConfig(s))
    setReport(null)
    setScreen('setup')
  }

  const changeBuild = (b: string) => {
    if (!specId) return
    const s = specById(specId, b)!
    localStorage.setItem(`rt-${specId}-build`, b)
    setBuildId(b)
    setConfig(loadConfig(s))
    setReport(null)
    setScreen('setup')
  }

  const startTraining = (cfg: TrainingConfig) => {
    if (!spec) return
    localStorage.setItem(storageKey(spec, 'keybinds')[0], JSON.stringify(cfg.keybinds))
    localStorage.setItem(storageKey(spec, 'barorder')[0], JSON.stringify(cfg.barOrder))
    localStorage.setItem(storageKey(spec, 'settings')[0], JSON.stringify({
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
          key={`${spec.specId}--${buildIdOf(spec)}`}
          spec={spec} config={config} onStart={startTraining} lastReport={report}
          variants={specVariants(spec.specId)}
          onChangeBuild={changeBuild}
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
