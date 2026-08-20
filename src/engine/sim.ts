import { RngBank } from './rng'
import type {
  AbilityDef, ActiveAura, CastEvent, DamageEvent, SimAPI, SimConfig, SpecConfig, Stats, Unit,
} from './types'

interface ScheduledEvent {
  time: number
  seq: number
  fn: () => void
  cancelled?: boolean
}

const QUEUE_WINDOW = 0.4
const GCD_BASE = 1.5
const GCD_FLOOR = 0.75
export const LUST_HASTE = 0.3
export const LUST_DURATION = 40

interface CooldownState {
  charges: number
  maxCharges: number
  /** when the next charge comes back (Infinity if full) */
  nextChargeAt: number
}

export class Sim implements SimAPI {
  time = 0
  insanity: number
  stats: Stats
  spec: SpecConfig
  data: Record<string, number> = {}

  casting: { abilityId: string; startedAt: number; finishAt: number; channel: boolean } | null = null
  gcdReadyAt = 0

  totalDamage = 0
  wastedInsanity = 0
  damageLog: DamageEvent[] = []
  castLog: CastEvent[] = []
  combatStarted = false
  private combatStartAt: number | null = null

  private rngBank: RngBank
  private events: ScheduledEvent[] = []
  private seq = 0
  private auras: ActiveAura[] = []
  /** per-rune time it becomes ready (specs with a rune pool) */
  private runeReadyAt: number[] = []
  private uptimeAcc = new Map<string, number>()
  private uptimeSince = new Map<string, number>()
  private cooldowns = new Map<string, CooldownState>()
  private abilityMap = new Map<string, AbilityDef>()
  private auraDefMap = new Map<string, import('./types').AuraDef>()
  private channelTickEvents: ScheduledEvent[] = []
  private queued: string | null = null
  private queuedEvent: ScheduledEvent | null = null
  private lastReadyAt = 0
  readonly config: SimConfig
  /** when true (player runs), grade each cast against the oracle policy */
  gradeCasts = true

  constructor(spec: SpecConfig, config: SimConfig) {
    this.spec = spec
    this.config = config
    this.stats = config.stats
    this.insanity = spec.startingResource ?? 0
    this.rngBank = new RngBank(config.seed)
    for (const a of spec.abilities) {
      this.abilityMap.set(a.id, a)
      this.cooldowns.set(a.id, {
        charges: a.charges ?? 1,
        maxCharges: a.charges ?? 1,
        nextChargeAt: Infinity,
      })
    }
    for (const au of spec.auras) this.auraDefMap.set(au.id, au)
    if (spec.runes) this.runeReadyAt = new Array(spec.runes.max).fill(0)
  }

  // ---- runes ----

  runesReady(): number {
    return this.runeReadyAt.filter(t => t <= this.time + 1e-9).length
  }

  nextRuneIn(): number {
    const waiting = this.runeReadyAt.filter(t => t > this.time + 1e-9)
    if (!waiting.length) return 0
    return Math.min(...waiting) - this.time
  }

  private spendRunes(n: number) {
    const recharge = (this.spec.runes?.rechargeTime ?? 10) * this.hasteMult()
    for (let i = 0; i < n; i++) {
      let idx = -1
      for (let j = 0; j < this.runeReadyAt.length; j++) {
        if (this.runeReadyAt[j] <= this.time + 1e-9 && (idx < 0 || this.runeReadyAt[j] < this.runeReadyAt[idx])) idx = j
      }
      if (idx < 0) return
      // only 3 runes recharge at once (simc MAX_REGENERATING_RUNES); a 4th+
      // spent rune starts its recharge when a slot frees up
      const outstanding = this.runeReadyAt.filter(t => t > this.time + 1e-9).sort((a, b) => a - b)
      const start = outstanding.length < 3 ? this.time : outstanding[outstanding.length - 3]
      this.runeReadyAt[idx] = start + recharge
    }
  }

  refundRune() {
    let idx = -1
    for (let j = 0; j < this.runeReadyAt.length; j++) {
      if (this.runeReadyAt[j] > this.time + 1e-9 && (idx < 0 || this.runeReadyAt[j] < this.runeReadyAt[idx])) idx = j
    }
    if (idx >= 0) this.runeReadyAt[idx] = this.time
  }

  /** UI: readiness fraction per rune (1 = ready) */
  runeInfo(): { ready: boolean; frac: number }[] {
    const recharge = (this.spec.runes?.rechargeTime ?? 10) * this.hasteMult()
    return this.runeReadyAt
      .map(t => {
        const remain = Math.max(0, t - this.time)
        return { ready: remain <= 1e-9, frac: Math.max(0, Math.min(1, 1 - remain / recharge)) }
      })
      .sort((a, b) => b.frac - a.frac)
  }

  // ---- time & events ----

  schedule(at: number, fn: () => void): ScheduledEvent {
    const ev: ScheduledEvent = { time: at, seq: this.seq++, fn }
    this.events.push(ev)
    return ev
  }

  cancel(ev: ScheduledEvent | null) {
    if (ev) ev.cancelled = true
  }

  /** advance simulation time to `to`, firing all due events in order */
  advance(to: number) {
    for (;;) {
      let best: ScheduledEvent | null = null
      let bestIdx = -1
      for (let i = 0; i < this.events.length; i++) {
        const e = this.events[i]
        if (e.cancelled) continue
        if (e.time <= to && (!best || e.time < best.time || (e.time === best.time && e.seq < best.seq))) {
          best = e
          bestIdx = i
        }
      }
      if (!best) break
      this.events.splice(bestIdx, 1)
      this.time = Math.max(this.time, best.time)
      best.fn()
    }
    // drop cancelled events occasionally
    if (this.events.length > 64) this.events = this.events.filter(e => !e.cancelled)
    this.time = Math.max(this.time, to)
  }

  beginCombat() {
    if (this.combatStarted) return
    this.combatStarted = true
    this.combatStartAt = this.time
    this.lastReadyAt = this.time
    this.spec.onCombatStart?.(this)
  }

  /** seconds of Bloodlust left (0 when not lusting) */
  lustRemaining(): number {
    if (!this.config.lustOnPull || this.combatStartAt === null) return 0
    return Math.max(0, LUST_DURATION - (this.time - this.combatStartAt))
  }

  // ---- rng / stats ----

  rng(stream: string): number {
    return this.rngBank.roll(stream)
  }

  hasteMult(): number {
    const bonus = this.spec.hasteMod?.(this) ?? 0
    const lust = this.lustRemaining() > 0 ? LUST_HASTE : 0
    return 1 / (1 + this.stats.haste + bonus + lust)
  }

  gcdLength(): number {
    return Math.max(GCD_FLOOR, GCD_BASE * this.hasteMult())
  }

  // ---- auras ----

  private auraDef(id: string) {
    const d = this.auraDefMap.get(id)
    if (!d) throw new Error(`Unknown aura: ${id}`)
    return d
  }

  aura(unit: Unit, id: string): ActiveAura | undefined {
    return this.auras.find(a => a.unit === unit && a.defId === id && a.expiresAt > this.time)
  }

  auraRemains(unit: Unit, id: string): number {
    const a = this.aura(unit, id)
    return a ? Math.max(0, a.expiresAt - this.time) : 0
  }

  stacks(unit: Unit, id: string): number {
    return this.aura(unit, id)?.stacks ?? 0
  }

  applyAura(unit: Unit, id: string, opts?: { duration?: number; stacks?: number }): ActiveAura {
    const def = this.auraDef(id)
    const dur = opts?.duration ?? def.duration
    const existing = this.aura(unit, id)
    if (existing) {
      let newExpiry: number
      const remaining = existing.expiresAt - this.time
      if (def.rollover) {
        newExpiry = this.time + dur + remaining
      } else if (def.pandemic) {
        newExpiry = this.time + dur + Math.min(remaining, 0.3 * dur)
      } else {
        newExpiry = this.time + dur
      }
      existing.expiresAt = newExpiry
      existing.appliedAt = this.time
      if (opts?.stacks) {
        existing.stacks = Math.min(def.maxStacks ?? 1, existing.stacks + opts.stacks)
      }
      def.onApply?.(this, existing)
      return existing
    }
    const aura: ActiveAura = {
      defId: id,
      unit,
      appliedAt: this.time,
      expiresAt: this.time + dur,
      stacks: opts?.stacks ?? 1,
      data: {},
    }
    this.auras.push(aura)
    if (unit === 'target' && !this.uptimeSince.has(id)) this.uptimeSince.set(id, this.time)
    if (def.tick) {
      const interval = def.tick.hasted ? def.tick.interval * this.hasteMult() : def.tick.interval
      aura.tickInterval = interval
      aura.nextTickAt = this.time + interval
      this.scheduleAuraTick(aura)
    }
    this.scheduleAuraExpiry(aura)
    def.onApply?.(this, aura)
    return aura
  }

  private scheduleAuraTick(aura: ActiveAura) {
    if (aura.nextTickAt === undefined) return
    const at = aura.nextTickAt
    this.schedule(at, () => {
      if (aura.expiresAt <= at - 1e-9 || !this.auras.includes(aura)) return
      const def = this.auraDef(aura.defId)
      if (!def.tick) return
      def.tick.onTick(this, aura)
      aura.nextTickAt = at + (aura.tickInterval ?? def.tick.interval)
      if (aura.nextTickAt <= aura.expiresAt + 1e-9) this.scheduleAuraTick(aura)
    })
  }

  private scheduleAuraExpiry(aura: ActiveAura) {
    const target = aura.expiresAt
    // tiny offset so a tick landing exactly at expiry still fires first
    this.schedule(target + 1e-6, () => {
      // may have been refreshed since scheduling
      if (!this.auras.includes(aura)) return
      if (aura.expiresAt > target + 1e-9) {
        this.scheduleAuraExpiry(aura)
        return
      }
      this.dropAura(aura)
    })
  }

  private dropAura(aura: ActiveAura) {
    this.auras = this.auras.filter(a => a !== aura)
    if (aura.unit === 'target') {
      const since = this.uptimeSince.get(aura.defId)
      if (since !== undefined) {
        this.uptimeAcc.set(aura.defId, (this.uptimeAcc.get(aura.defId) ?? 0) + this.time - since)
        this.uptimeSince.delete(aura.defId)
      }
    }
    this.auraDef(aura.defId).onExpire?.(this, aura)
  }

  removeAura(unit: Unit, id: string) {
    const a = this.aura(unit, id)
    if (a) this.dropAura(a)
  }

  /** total seconds this debuff has been active on the target so far */
  debuffUptime(id: string): number {
    const acc = this.uptimeAcc.get(id) ?? 0
    const since = this.uptimeSince.get(id)
    return acc + (since !== undefined ? this.time - since : 0)
  }

  extendAura(unit: Unit, id: string, seconds: number) {
    const a = this.aura(unit, id)
    if (a) a.expiresAt += seconds
  }

  consumeStack(unit: Unit, id: string) {
    const a = this.aura(unit, id)
    if (!a) return
    a.stacks -= 1
    if (a.stacks <= 0) this.dropAura(a)
  }

  allAuras(unit: Unit): ActiveAura[] {
    return this.auras.filter(a => a.unit === unit && a.expiresAt > this.time)
  }

  // ---- resource ----

  gain(amount: number, _source: string) {
    const room = this.spec.resourceMax - this.insanity
    const gained = Math.min(room, amount)
    this.insanity += gained
    if (amount > gained) this.wastedInsanity += amount - gained
  }

  spend(amount: number) {
    this.insanity = Math.max(0, this.insanity - amount)
  }

  // ---- damage ----

  damage(spellId: string, coeff: number, opts?: { canCrit?: boolean; tags?: string[] }) {
    const canCrit = opts?.canCrit ?? true
    let amount = coeff
    if (canCrit) amount *= 1 + this.stats.critChance * (this.stats.critMult - 1)
    const mult = this.spec.damageMult?.(this, spellId, opts?.tags ?? []) ?? 1
    amount *= mult
    this.totalDamage += amount
    this.damageLog.push({ time: this.time, spellId, amount })
  }

  // ---- abilities & cooldowns ----

  ability(id: string): AbilityDef {
    const a = this.abilityMap.get(id)
    if (!a) throw new Error(`Unknown ability: ${id}`)
    return a
  }

  private cd(id: string): CooldownState {
    const c = this.cooldowns.get(id)
    if (!c) throw new Error(`Unknown ability: ${id}`)
    return c
  }

  cooldownRemains(id: string): number {
    const c = this.cd(id)
    if (c.charges > 0) return 0
    return Math.max(0, c.nextChargeAt - this.time)
  }

  chargesOf(id: string): number {
    return this.cd(id).charges
  }

  resetCooldown(id: string) {
    const c = this.cd(id)
    c.charges = c.maxCharges
    c.nextChargeAt = Infinity
  }

  reduceCooldown(id: string, seconds: number) {
    const c = this.cd(id)
    if (c.nextChargeAt === Infinity) return
    c.nextChargeAt -= seconds
    if (c.nextChargeAt <= this.time) this.rechargeNow(id)
  }

  private startCooldown(id: string) {
    const def = this.ability(id)
    if (!def.cooldown) return
    if (def.noCooldownIf?.(this)) return
    const c = this.cd(id)
    c.charges -= 1
    if (c.nextChargeAt === Infinity) {
      c.nextChargeAt = this.time + def.cooldown
      this.scheduleRecharge(id)
    }
  }

  private scheduleRecharge(id: string) {
    const c = this.cd(id)
    const at = c.nextChargeAt
    if (at === Infinity) return
    this.schedule(at, () => {
      if (Math.abs(c.nextChargeAt - at) > 1e-9) {
        this.scheduleRecharge(id)
        return
      }
      this.rechargeNow(id)
    })
  }

  private rechargeNow(id: string) {
    const def = this.ability(id)
    const c = this.cd(id)
    c.charges = Math.min(c.maxCharges, c.charges + 1)
    if (c.charges < c.maxCharges && def.cooldown) {
      c.nextChargeAt = this.time + def.cooldown
      this.scheduleRecharge(id)
    } else {
      c.nextChargeAt = Infinity
    }
  }

  effectiveCost(def: AbilityDef): number {
    if (def.costMod) return def.costMod(this)
    return def.cost ?? 0
  }

  effectiveCastTime(def: AbilityDef): number {
    let base = def.castTime ?? 0
    if (def.castTimeMod) base = def.castTimeMod(this, base)
    return base * this.hasteMult()
  }

  isUsable(id: string): true | string {
    const def = this.ability(id)
    // a proc-transformed press doesn't touch the base ability's cooldown
    const bypassCd = def.noCooldownIf?.(this) ?? false
    if (!bypassCd && this.cd(id).charges <= 0) return 'on cooldown'
    if (this.effectiveCost(def) > this.insanity) return `not enough ${this.spec.resourceName}`
    const runeCost = def.runeCostMod ? def.runeCostMod(this) : def.runeCost ?? 0
    if (runeCost > 0 && this.runesReady() < runeCost) return 'not enough runes'
    if (def.usable) {
      const r = def.usable(this)
      if (r !== true) return r
    }
    return true
  }

  /** seconds until this ability could be pressed (GCD + cooldown + cast), ignoring resources */
  timeToUsable(id: string): number {
    const def = this.ability(id)
    const cdWait = def.noCooldownIf?.(this) ? 0 : this.cooldownRemains(id)
    const gcdWait = def.offGcd ? 0 : Math.max(0, this.gcdReadyAt - this.time)
    // channels don't block — they're clipped by the next press
    const castWait = this.casting && !this.casting.channel ? Math.max(0, this.casting.finishAt - this.time) : 0
    let runeWait = 0
    const runeCost = def.runeCostMod ? def.runeCostMod(this) : def.runeCost ?? 0
    if (runeCost > 0 && this.runesReady() < runeCost) {
      const waiting = this.runeReadyAt.filter(t => t > this.time + 1e-9).sort((a, b) => a - b)
      const needed = runeCost - this.runesReady()
      runeWait = waiting.length >= needed ? waiting[needed - 1] - this.time : Infinity
    }
    return Math.max(cdWait, gcdWait, castWait, runeWait)
  }

  /**
   * Player/oracle input. Returns 'cast' | 'queued' | reason string.
   */
  press(id: string): string {
    const def = this.ability(id)
    // off-GCD abilities can be pressed at any time, even mid-cast
    const busyUntil = def.offGcd ? 0 : Math.max(
      this.gcdReadyAt,
      this.casting && !this.casting.channel ? this.casting.finishAt : 0,
    )
    if (busyUntil > this.time + 1e-9) {
      if (busyUntil <= this.time + QUEUE_WINDOW) {
        // spell queue: fire when ready
        this.cancel(this.queuedEvent)
        this.queued = id
        this.queuedEvent = this.schedule(busyUntil, () => {
          if (this.queued === id) {
            this.queued = null
            this.press(id)
          }
        })
        return 'queued'
      }
      return this.casting && !this.casting.channel ? 'casting' : 'gcd'
    }
    const usable = this.isUsable(id)
    if (usable !== true) return usable

    if (!this.combatStarted) this.beginCombat()

    // clip an active channel (off-GCD presses don't)
    if (this.casting?.channel && !def.offGcd) this.interruptChannel()

    // grade this decision before mutating state
    if (this.gradeCasts && !def.offGcd) {
      const oracleChoice = this.spec.policy(this)
      const deadTime = Math.max(0, this.time - this.lastReadyAt)
      this.castLog.push({
        time: this.time,
        abilityId: id,
        oracleChoice,
        deadTime,
        insanityBefore: this.insanity,
        insanityAfter: this.insanity, // patched after resolve
      })
    }

    def.onCastStart?.(this)

    if (!def.offGcd) {
      this.gcdReadyAt = this.time + this.gcdLength()
      this.scheduleReadyTracker()
    }

    const castTime = this.effectiveCastTime(def)
    if (def.channel) {
      this.startChannel(def)
      this.startCooldown(id)
    } else if (castTime > 0) {
      this.casting = { abilityId: id, startedAt: this.time, finishAt: this.time + castTime, channel: false }
      this.schedule(this.time + castTime, () => {
        if (this.casting?.abilityId === id) {
          this.casting = null
          this.resolveCast(def)
          this.scheduleReadyTracker()
        }
      })
      this.startCooldown(id)
    } else {
      // charge is consumed before resolution so noCooldownIf can read pre-cast proc state
      this.startCooldown(id)
      this.resolveCast(def)
    }
    return 'cast'
  }

  private resolveCast(def: AbilityDef) {
    const cost = this.effectiveCost(def)
    if (cost > 0) this.spend(cost)
    const runeCost = def.runeCostMod ? def.runeCostMod(this) : def.runeCost ?? 0
    if (runeCost > 0) this.spendRunes(runeCost)
    def.onResolve(this)
    const last = this.castLog[this.castLog.length - 1]
    if (last && last.abilityId === def.id) last.insanityAfter = this.insanity
  }

  private startChannel(def: AbilityDef) {
    const ch = typeof def.channel === 'function' ? def.channel(this) : def.channel!
    const mult = ch.hasted === false ? 1 : this.hasteMult()
    const duration = ch.duration * mult
    const tickInterval = duration / ch.ticks
    this.casting = { abilityId: def.id, startedAt: this.time, finishAt: this.time + duration, channel: true }
    const cost = this.effectiveCost(def)
    if (cost > 0) this.spend(cost)
    this.channelTickEvents = []
    for (let i = 1; i <= ch.ticks; i++) {
      const ev = this.schedule(this.time + tickInterval * i, () => {
        ch.onTick(this, i)
        if (i === ch.ticks && this.casting?.abilityId === def.id) {
          this.casting = null
          this.scheduleReadyTracker()
        }
      })
      this.channelTickEvents.push(ev)
    }
  }

  private interruptChannel() {
    for (const ev of this.channelTickEvents) this.cancel(ev)
    this.channelTickEvents = []
    this.casting = null
  }

  /** track when the player next becomes free, for dead-time measurement */
  private scheduleReadyTracker() {
    const readyAt = Math.max(this.gcdReadyAt, this.casting && !this.casting.channel ? this.casting.finishAt : 0)
    this.schedule(readyAt, () => {
      const nowReady = Math.max(this.gcdReadyAt, this.casting && !this.casting.channel ? this.casting.finishAt : 0)
      if (nowReady <= this.time + 1e-9) this.lastReadyAt = Math.max(this.lastReadyAt, readyAt)
    })
  }

  /** is the player free to start a new (on-GCD) cast right now? */
  isReady(): boolean {
    if (this.casting && !this.casting.channel) return false
    return this.gcdReadyAt <= this.time + 1e-9
  }
}

/** Run the spec's own policy bot for the full duration — the score baseline. */
export function runOracle(spec: SpecConfig, config: SimConfig): Sim {
  const sim = new Sim(spec, config)
  sim.gradeCasts = false
  sim.beginCombat()
  const step = 0.05
  let guard = 0
  while (sim.time < config.duration && guard++ < 200000) {
    if (sim.isReady()) {
      const choice = spec.policy(sim)
      if (choice && sim.isUsable(choice) === true) {
        sim.press(choice)
        continue
      }
    }
    sim.advance(Math.min(config.duration, sim.time + step))
  }
  return sim
}
