import { describe, expect, it } from 'vitest'
import { Sim, runOracle } from './sim'
import type { SpecConfig } from './types'

const STATS = { haste: 0, critChance: 0, critMult: 2 }

function toySpec(): SpecConfig {
  return {
    name: 'Toy',
    specId: 'toy',
    resourceName: 'Fury',
    resourceMax: 100,
    abilities: [
      {
        id: 'builder',
        name: 'Builder',
        icon: 'x',
        onResolve: s => { s.gain(20, 'builder'); s.damage('builder', 10) },
      },
      {
        id: 'spender',
        name: 'Spender',
        icon: 'x',
        cost: 50,
        onResolve: s => s.damage('spender', 100),
      },
      {
        id: 'dotter',
        name: 'Dotter',
        icon: 'x',
        onResolve: s => s.applyAura('target', 'dot'),
      },
      {
        id: 'nuke',
        name: 'Nuke',
        icon: 'x',
        castTime: 2,
        cooldown: 10,
        onResolve: s => s.damage('nuke', 50),
      },
      {
        id: 'burst',
        name: 'Burst',
        icon: 'x',
        cooldown: 30,
        charges: 2,
        onResolve: s => s.damage('burst', 30),
      },
    ],
    auras: [
      {
        id: 'dot',
        name: 'Dot',
        duration: 12,
        pandemic: true,
        debuff: true,
        tick: { interval: 3, onTick: s => s.damage('dot', 5) },
      },
    ],
    actionBar: ['builder', 'spender', 'dotter', 'nuke', 'burst'],
    policy: s => {
      if (s.auraRemains('target', 'dot') < 3.6) return 'dotter'
      if (s.insanity >= 50) return 'spender'
      return 'builder'
    },
  }
}

function makeSim() {
  return new Sim(toySpec(), { seed: 42, duration: 60, stats: STATS })
}

describe('gcd & instant casts', () => {
  it('resolves an instant and starts the GCD', () => {
    const sim = makeSim()
    expect(sim.press('builder')).toBe('cast')
    expect(sim.insanity).toBe(20)
    expect(sim.totalDamage).toBe(10)
    sim.advance(1.2)
    expect(sim.press('builder')).toBe('queued') // inside 0.4s queue window
    sim.advance(1.5)
    expect(sim.insanity).toBe(40) // queued cast fired at gcd end
  })

  it('rejects a press outside the queue window', () => {
    const sim = makeSim()
    sim.press('builder')
    sim.advance(0.2)
    expect(sim.press('builder')).toBe('gcd')
  })
})

describe('resources', () => {
  it('spends and refuses when short', () => {
    const sim = makeSim()
    expect(sim.press('spender')).toMatch(/not enough/)
    sim.press('builder'); sim.advance(1.5)
    sim.press('builder'); sim.advance(3)
    sim.press('builder'); sim.advance(4.5)
    expect(sim.insanity).toBe(60)
    expect(sim.press('spender')).toBe('cast')
    expect(sim.insanity).toBe(10)
  })

  it('tracks overcap waste', () => {
    const sim = makeSim()
    for (let i = 0; i < 6; i++) {
      sim.press('builder')
      sim.advance(sim.time + 1.5)
    }
    expect(sim.insanity).toBe(100)
    expect(sim.wastedInsanity).toBe(20)
  })
})

describe('dots', () => {
  it('ticks on schedule', () => {
    const sim = makeSim()
    sim.press('dotter')
    sim.advance(12.1)
    expect(sim.damageLog.filter(d => d.spellId === 'dot').length).toBe(4)
    expect(sim.aura('target', 'dot')).toBeUndefined()
  })

  it('pandemic refresh caps at 130% duration', () => {
    const sim = makeSim()
    sim.press('dotter')
    sim.advance(1.5)
    sim.press('dotter') // 10.5s remaining -> min(10.5, 3.6) bonus
    expect(sim.auraRemains('target', 'dot')).toBeCloseTo(12 + 3.6, 5)
  })
})

describe('cast times & cooldowns', () => {
  it('cast time delays damage; cooldown starts on cast start', () => {
    const sim = makeSim()
    sim.press('nuke')
    expect(sim.totalDamage).toBe(0)
    sim.advance(2)
    expect(sim.totalDamage).toBe(50)
    expect(sim.cooldownRemains('nuke')).toBeCloseTo(8, 5)
  })

  it('charges recharge sequentially', () => {
    const sim = makeSim()
    sim.press('burst')
    expect(sim.chargesOf('burst')).toBe(1)
    sim.advance(1.5)
    sim.press('burst')
    expect(sim.chargesOf('burst')).toBe(0)
    sim.advance(30.1)
    expect(sim.chargesOf('burst')).toBe(1)
    sim.advance(61)
    expect(sim.chargesOf('burst')).toBe(2)
  })
})

describe('haste', () => {
  it('shortens the GCD with a 0.75s floor', () => {
    const sim = new Sim(toySpec(), { seed: 1, duration: 60, stats: { haste: 0.2, critChance: 0, critMult: 2 } })
    expect(sim.gcdLength()).toBeCloseTo(1.25, 5)
    const fast = new Sim(toySpec(), { seed: 1, duration: 60, stats: { haste: 3, critChance: 0, critMult: 2 } })
    expect(fast.gcdLength()).toBe(0.75)
  })
})

describe('runes', () => {
  function runeSpec(): SpecConfig {
    return {
      name: 'RuneToy',
      specId: 'runetoy',
      resourceName: 'Runic Power',
      resourceMax: 100,
      runes: { max: 6, rechargeTime: 10 },
      abilities: [
        {
          id: 'strike',
          name: 'Strike',
          icon: 'x',
          runeCost: 2,
          onResolve: s => { s.gain(20, 'strike'); s.damage('strike', 10) },
        },
      ],
      auras: [],
      actionBar: ['strike'],
      policy: () => 'strike',
    }
  }

  it('spends runes, recharges them in parallel with haste', () => {
    const sim = new Sim(runeSpec(), { seed: 1, duration: 60, stats: { haste: 0.25, critChance: 0, critMult: 2 } })
    sim.gradeCasts = false
    sim.beginCombat()
    expect(sim.runesReady()).toBe(6)
    sim.press('strike'); sim.advance(1.5)
    sim.press('strike'); sim.advance(3)
    sim.press('strike')
    expect(sim.runesReady()).toBe(0)
    expect(sim.insanity).toBe(60)
    sim.advance(4.5) // clear the GCD so the rune gate is what blocks
    expect(sim.press('strike')).toBe('not enough runes')
    // 10s / 1.25 = 8s recharge; only 3 recharge concurrently, so the queue is:
    // t=0 pair -> ready 8; t=1.5 pair -> 9.5 and (queued behind t=8) 16;
    // t=3 pair -> (behind 8) 16 and (behind 9.5) 17.5
    sim.advance(8.05)
    expect(sim.runesReady()).toBe(2)
    sim.advance(11.05)
    expect(sim.runesReady()).toBe(3)
    sim.advance(17.55)
    expect(sim.runesReady()).toBe(6)
  })

  it('refundRune restores the soonest recharging rune', () => {
    const sim = new Sim(runeSpec(), { seed: 1, duration: 60, stats: { haste: 0, critChance: 0, critMult: 2 } })
    sim.gradeCasts = false
    sim.beginCombat()
    sim.press('strike')
    expect(sim.runesReady()).toBe(4)
    sim.refundRune()
    expect(sim.runesReady()).toBe(5)
  })
})

describe('debuff uptime', () => {
  it('accumulates active time across the fight', () => {
    const sim = makeSim()
    sim.press('dotter') // 12s dot
    sim.advance(6)
    expect(sim.debuffUptime('dot')).toBeCloseTo(6, 3)
    sim.advance(30) // dot expired at 12
    expect(sim.debuffUptime('dot')).toBeCloseTo(12, 3)
    sim.press('dotter')
    sim.advance(33)
    expect(sim.debuffUptime('dot')).toBeCloseTo(15, 3)
  })
})

describe('bloodlust', () => {
  it('adds 30% haste for 40s from the pull', () => {
    const sim = new Sim(toySpec(), { seed: 1, duration: 60, stats: { haste: 0.1, critChance: 0, critMult: 2 }, lustOnPull: true })
    expect(sim.gcdLength()).toBeCloseTo(1.5 / 1.1, 4) // not pulled yet
    sim.beginCombat()
    expect(sim.lustRemaining()).toBe(40)
    expect(sim.gcdLength()).toBeCloseTo(1.5 / 1.4, 4)
    sim.advance(41)
    expect(sim.lustRemaining()).toBe(0)
    expect(sim.gcdLength()).toBeCloseTo(1.5 / 1.1, 4)
  })
})

describe('determinism & oracle', () => {
  it('same seed gives identical oracle runs', () => {
    const spec = toySpec()
    const a = runOracle(spec, { seed: 7, duration: 60, stats: STATS })
    const b = runOracle(toySpec(), { seed: 7, duration: 60, stats: STATS })
    expect(a.totalDamage).toBe(b.totalDamage)
    expect(a.damageLog.length).toBe(b.damageLog.length)
  })

  it('oracle keeps the dot rolling and spends before capping', () => {
    const spec = toySpec()
    const sim = runOracle(spec, { seed: 7, duration: 60, stats: STATS })
    expect(sim.wastedInsanity).toBe(0)
    const dotDamage = sim.damageLog.filter(d => d.spellId === 'dot').length
    expect(dotDamage).toBeGreaterThan(15) // near-full uptime over 60s
  })
})
