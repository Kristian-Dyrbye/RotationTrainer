import { useState } from 'react'
import type { ScoreReport } from './engine/score'
import { shadowPriest } from './specs/shadowPriest/spec'
import { SetupScreen } from './ui/SetupScreen'
import { TrainingScreen } from './ui/TrainingScreen'
import { ReportScreen } from './ui/ReportScreen'

export interface TrainingConfig {
  duration: number
  seed: number
  keybinds: string[] // KeyboardEvent.code per action-bar slot
}

const DEFAULT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal']

function loadKeybinds(slots: number): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem('rt-keybinds') ?? 'null')
    if (Array.isArray(saved) && saved.length >= slots) return saved.slice(0, slots)
  } catch { /* fall through */ }
  return DEFAULT_KEYS.slice(0, slots)
}

export default function App() {
  const spec = shadowPriest
  const [screen, setScreen] = useState<'setup' | 'training' | 'report'>('setup')
  const [config, setConfig] = useState<TrainingConfig>({
    duration: 90,
    seed: 1,
    keybinds: loadKeybinds(spec.actionBar.length),
  })
  const [report, setReport] = useState<ScoreReport | null>(null)

  const startTraining = (cfg: TrainingConfig) => {
    localStorage.setItem('rt-keybinds', JSON.stringify(cfg.keybinds))
    setConfig({ ...cfg, seed: Math.floor(Math.random() * 1e9) })
    setScreen('training')
  }

  return (
    <div className="app">
      {screen === 'setup' && (
        <SetupScreen spec={spec} config={config} onStart={startTraining} lastReport={report} />
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
