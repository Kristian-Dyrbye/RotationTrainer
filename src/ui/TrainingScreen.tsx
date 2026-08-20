import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sim, runOracle } from '../engine/sim'
import { buildReport, type ScoreReport } from '../engine/score'
import type { SpecConfig } from '../engine/types'
import type { TrainingConfig } from '../App'
import { iconUrl } from './icons'
import { comboFromEvent, useKeyLabels } from './keys'
import { PriorityPanel } from './PriorityPanel'

export function TrainingScreen({ spec, config, onFinish, onAbort }: {
  spec: SpecConfig
  config: TrainingConfig
  onFinish: (r: ScoreReport) => void
  onAbort: () => void
}) {
  const simConfig = useMemo(() => ({
    seed: config.seed,
    duration: config.duration,
    stats: { haste: config.hastePct / 100, critChance: config.critPct / 100, critMult: 2.0 },
    lustOnPull: config.lustOnPull,
  }), [config])
  const sim = useMemo(() => new Sim(spec, simConfig), [spec, simConfig])
  const startRef = useRef<number | null>(null)
  const finishedRef = useRef(false)
  const [, setTick] = useState(0)
  const [flash, setFlash] = useState<{ msg: string; at: number } | null>(null)
  const keyLabel = useKeyLabels()

  // game loop
  useEffect(() => {
    let raf = 0
    const loop = () => {
      if (startRef.current !== null && !finishedRef.current) {
        const elapsed = (performance.now() - startRef.current) / 1000
        sim.advance(Math.min(elapsed, config.duration))
        if (elapsed >= config.duration) {
          finishedRef.current = true
          const oracle = runOracle(spec, simConfig)
          onFinish(buildReport(sim, oracle))
          return
        }
      }
      setTick(t => t + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [sim, spec, config, simConfig, onFinish])

  // shared by keyboard and mouse input
  const pressSlot = useCallback((slot: number) => {
    if (finishedRef.current) return
    if (startRef.current === null) startRef.current = performance.now()
    const elapsed = (performance.now() - startRef.current) / 1000
    sim.advance(Math.min(elapsed, config.duration))
    const result = sim.press(config.barOrder[slot])
    if (result !== 'cast' && result !== 'queued') {
      setFlash({ msg: result, at: performance.now() })
    }
  }, [sim, spec, config])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Escape') { onAbort(); return }
      const combo = comboFromEvent(e)
      if (!combo) return
      const slot = config.keybinds.indexOf(combo)
      if (slot < 0 || slot >= config.barOrder.length) return
      e.preventDefault()
      pressSlot(slot)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [config, spec, pressSlot, onAbort])

  const started = startRef.current !== null
  const remaining = Math.max(0, config.duration - sim.time)
  const insanityPct = (sim.insanity / spec.resourceMax) * 100
  const targetAuras = sim.allAuras('target')
  const playerAuras = sim.allAuras('player').filter(a => spec.auras.find(d => d.id === a.defId && !d.debuff))
  const casting = sim.casting
  const gcdFrac = Math.max(0, Math.min(1, (sim.gcdReadyAt - sim.time) / sim.gcdLength()))
  const showFlash = flash && performance.now() - flash.at < 900
  const dots = spec.auras.filter(a => a.debuff && a.tick)
  const lustLeft = sim.lustRemaining()

  return (
    <div className="training with-sidebar">
      <PriorityPanel spec={spec} sim={sim} live={config.liveHints} />
      <div className="training-main">
      <div className="hud-top">
        <div className="timer mono">{started ? `${remaining.toFixed(1)}s` : `${config.duration}s`}</div>
        <div className="dps mono">{started && sim.time > 1 ? `${(sim.totalDamage / sim.time).toFixed(1)} dmg/s` : '—'}</div>
        <button className="chip" onClick={onAbort}>Esc · abort</button>
      </div>

      {/* target dummy frame */}
      <div className="target-frame">
        <div className="target-name">Training Dummy</div>
        <div className="debuff-row">
          {targetAuras.map(a => {
            const def = spec.auras.find(d => d.id === a.defId)
            if (!def?.icon) return null
            const total = a.expiresAt - a.appliedAt
            const frac = Math.max(0, (a.expiresAt - sim.time) / total)
            const pandemic = def.pandemic && (a.expiresAt - sim.time) <= 0.3 * def.duration
            return (
              <div key={a.defId} className={`aura debuff ${pandemic ? 'pandemic' : ''}`} title={def.name}>
                <img src={iconUrl(def.icon)} alt={def.name} />
                <div className="aura-bar"><div style={{ width: `${frac * 100}%` }} /></div>
                <span className="aura-time mono">{(a.expiresAt - sim.time).toFixed(1)}</span>
                {a.stacks > 1 && <span className="aura-stacks">{a.stacks}</span>}
              </div>
            )
          })}
          {targetAuras.length === 0 && <span className="hint">no DoTs on target</span>}
        </div>
        {started && sim.time > 3 && dots.length > 0 && (
          <div className="uptime-line mono">
            {dots.map(d => {
              const pct = Math.round((sim.debuffUptime(d.id) / sim.time) * 100)
              return (
                <span key={d.id} className={`uptime ${pct >= 90 ? 'good' : pct >= 70 ? 'ok' : 'bad'}`} title={`${d.name} uptime`}>
                  {d.name.split(':')[0].split(' ').map(w => w[0]).join('')} {pct}%
                </span>
              )
            })}
          </div>
        )}
      </div>

      {!started && (
        <div className="pull-hint">
          <h2>Press any bound key (or click an ability) to pull</h2>
          <p className="hint">Esc to leave · your rotation is scored from the first press</p>
        </div>
      )}

      <div className="hud-bottom">
        {/* player buffs */}
        <div className="buff-row">
          {lustLeft > 0 && (
            <div className="aura buff" title="Bloodlust">
              <img src={iconUrl('spell_nature_bloodlust')} alt="Bloodlust" />
              <span className="aura-time mono">{lustLeft.toFixed(1)}</span>
            </div>
          )}
          {playerAuras.map(a => {
            const def = spec.auras.find(d => d.id === a.defId)!
            if (!def.icon) return null
            const remains = a.expiresAt === Infinity ? null : a.expiresAt - sim.time
            return (
              <div key={a.defId} className="aura buff" title={def.name}>
                <img src={iconUrl(def.icon)} alt={def.name} />
                {remains !== null && <span className="aura-time mono">{remains.toFixed(1)}</span>}
                {a.stacks > 1 && <span className="aura-stacks">{a.stacks}</span>}
              </div>
            )
          })}
        </div>

        {/* cast bar */}
        <div className="castbar">
          {casting ? (
            <>
              <div
                className={`castbar-fill ${casting.channel ? 'channel' : ''}`}
                style={{
                  width: `${(casting.channel
                    ? (casting.finishAt - sim.time) / (casting.finishAt - casting.startedAt)
                    : (sim.time - casting.startedAt) / (casting.finishAt - casting.startedAt)) * 100}%`,
                }}
              />
              <span className="castbar-label">
                {sim.ability(casting.abilityId).displayName?.(sim) ?? sim.ability(casting.abilityId).name}
              </span>
            </>
          ) : (
            <span className="castbar-label idle">{showFlash ? flash!.msg : ''}</span>
          )}
        </div>

        {/* runes (DK specs) */}
        {spec.runes && (
          <div className="rune-row">
            {sim.runeInfo().map((r, i) => (
              <div key={i} className={`rune ${r.ready ? 'ready' : ''}`}>
                <div className="rune-fill" style={{ height: `${r.frac * 100}%` }} />
              </div>
            ))}
          </div>
        )}

        {/* main resource */}
        <div className="resource">
          <div className="resource-fill" style={{ width: `${insanityPct}%` }} />
          <span className="resource-label mono">{Math.floor(sim.insanity)} / {spec.resourceMax} {spec.resourceName}</span>
        </div>

        {/* action bar */}
        <div className="bar">
          {config.barOrder.map((abilityId, i) => {
            const a = spec.abilities.find(x => x.id === abilityId)!
            const name = a.displayName?.(sim) ?? a.name
            const icon = a.displayIcon?.(sim) ?? a.icon
            const cdRemains = sim.cooldownRemains(abilityId)
            const charges = sim.chargesOf(abilityId)
            const usable = sim.isUsable(abilityId)
            const onGcd = !a.offGcd && gcdFrac > 0
            const glow = spec.glows?.(sim, abilityId) ?? false
            // only show the cooldown sweep when the cooldown actually blocks the press
            // (a transformed button — e.g. Void Volley over Voidform — stays pressable)
            const onCd = usable !== true && charges === 0 && cdRemains > 0
            const cdFrac = onCd && a.cooldown ? cdRemains / a.cooldown : 0
            const procStacks = a.displayStacks?.(sim) ?? 0
            return (
              <button
                key={abilityId}
                className={`slot ${glow ? 'glow' : ''} ${usable !== true ? 'unusable' : ''}`}
                onClick={e => { e.currentTarget.blur(); pressSlot(i) }}
                title={name}
              >
                <img src={iconUrl(icon)} alt={name} draggable={false} />
                {cdFrac > 0 && (
                  <div className="cd-overlay" style={{ height: `${cdFrac * 100}%` }} />
                )}
                {onGcd && cdFrac === 0 && <div className="gcd-overlay" style={{ height: `${gcdFrac * 100}%` }} />}
                {onCd && <span className="cd-text mono">{cdRemains > 10 ? Math.ceil(cdRemains) : cdRemains.toFixed(1)}</span>}
                {(a.charges ?? 1) > 1 && <span className="charges mono">{charges}</span>}
                {procStacks > 0 && <span className="charges mono">{procStacks}</span>}
                <span className="keybind">{keyLabel(config.keybinds[i])}</span>
              </button>
            )
          })}
        </div>
      </div>
      </div>
    </div>
  )
}
