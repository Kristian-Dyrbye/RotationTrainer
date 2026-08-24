import { useState } from 'react'
import type { SpecConfig } from '../engine/types'
import { specs, buildIdOf } from '../specs'
import { iconUrl } from './icons'

type Role = 'melee' | 'ranged'

const MELEE = new Set([
  'dk-frost', 'dk-unholy',
  'dh-havoc', 'dh-devourer',
  'druid-feral',
  'hunter-survival',
  'monk-windwalker',
  'paladin-retribution',
  'rogue-assassination', 'rogue-outlaw', 'rogue-subtlety',
  'shaman-enhancement',
  'warrior-arms', 'warrior-fury',
])

const ROLES: { id: Role; name: string; icon: string; blurb: string }[] = [
  { id: 'melee', name: 'Melee DPS', icon: 'inv_sword_27', blurb: 'Up close — energy, rage, runes and combo points' },
  { id: 'ranged', name: 'Ranged DPS', icon: 'inv_weapon_bow_07', blurb: 'Casters and marksmen — casts, procs and DoTs' },
]

const CLASSES: Record<string, { name: string; icon: string }> = {
  dk: { name: 'Death Knight', icon: 'classicon_deathknight' },
  dh: { name: 'Demon Hunter', icon: 'classicon_demonhunter' },
  druid: { name: 'Druid', icon: 'classicon_druid' },
  evoker: { name: 'Evoker', icon: 'classicon_evoker' },
  hunter: { name: 'Hunter', icon: 'classicon_hunter' },
  mage: { name: 'Mage', icon: 'classicon_mage' },
  monk: { name: 'Monk', icon: 'classicon_monk' },
  paladin: { name: 'Paladin', icon: 'classicon_paladin' },
  priest: { name: 'Priest', icon: 'classicon_priest' },
  rogue: { name: 'Rogue', icon: 'classicon_rogue' },
  shaman: { name: 'Shaman', icon: 'classicon_shaman' },
  warlock: { name: 'Warlock', icon: 'classicon_warlock' },
  warrior: { name: 'Warrior', icon: 'classicon_warrior' },
}

function classOf(spec: SpecConfig): string {
  return spec.specId.split('-')[0]
}

function roleOf(spec: SpecConfig): Role {
  return MELEE.has(spec.specId) ? 'melee' : 'ranged'
}

/** spec display name without the class suffix ("Frost Mage" -> "Frost") */
function shortName(spec: SpecConfig): string {
  const cls = CLASSES[classOf(spec)]
  if (cls && spec.name.endsWith(` ${cls.name}`)) return spec.name.slice(0, -cls.name.length - 1)
  return spec.name
}

export function SpecPicker({ onPick }: { onPick: (specId: string, buildId?: string) => void }) {
  const [role, setRole] = useState<Role | null>(null)
  const [cls, setCls] = useState<string | null>(null)

  const inRole = role ? specs.filter(s => roleOf(s) === role) : []
  const classIds = [...new Set(inRole.map(classOf))]
    .sort((a, b) => CLASSES[a].name.localeCompare(CLASSES[b].name))
  const inClass = cls ? inRole.filter(s => classOf(s) === cls) : []

  const pickClass = (id: string) => {
    const specsHere = inRole.filter(s => classOf(s) === id)
    if (specsHere.length === 1) onPick(specsHere[0].specId, buildIdOf(specsHere[0]))
    else setCls(id)
  }

  return (
    <div className="picker">
      <header className="setup-head">
        <h1>Rotation Trainer</h1>
        <p className="sub hint">
          patch 12.1.0 ·{' '}
          {role === null ? 'pick your role'
            : cls === null ? `${role === 'melee' ? 'Melee' : 'Ranged'} DPS · pick your class`
            : `${CLASSES[cls].name} · pick your spec`}
        </p>
      </header>

      {role === null && (
        <div className="spec-grid">
          {ROLES.map(r => (
            <button key={r.id} className="spec-card role-card" onClick={() => setRole(r.id)}>
              <img src={iconUrl(r.icon)} alt="" />
              <span>{r.name}</span>
              <span className="hint">{r.blurb}</span>
            </button>
          ))}
        </div>
      )}

      {role !== null && cls === null && (
        <>
          <div className="spec-grid">
            {classIds.map(id => (
              <button key={id} className="spec-card" onClick={() => pickClass(id)}>
                <img src={iconUrl(CLASSES[id].icon)} alt="" />
                <span>{CLASSES[id].name}</span>
                <span className="hint">
                  {[...new Set(inRole.filter(s => classOf(s) === id).map(shortName))].join(' · ')}
                </span>
              </button>
            ))}
          </div>
          <button className="chip" onClick={() => setRole(null)}>← Back to roles</button>
        </>
      )}

      {role !== null && cls !== null && (
        <>
          <div className="spec-grid">
            {inClass.map(s => (
              <button
                key={`${s.specId}--${buildIdOf(s)}`}
                className="spec-card"
                onClick={() => onPick(s.specId, buildIdOf(s))}
              >
                <img src={iconUrl(s.specIcon ?? 'inv_misc_questionmark')} alt="" />
                <span>{s.name}{s.source ? ` — ${s.source.heroTalent}` : ''}</span>
              </button>
            ))}
          </div>
          <button className="chip" onClick={() => setCls(null)}>← Back to {role === 'melee' ? 'Melee' : 'Ranged'} classes</button>
        </>
      )}

      <p className="hint center">More specs are added as they're modeled — each is hand-built against live 12.1 data.</p>
    </div>
  )
}
