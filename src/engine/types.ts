export type Unit = 'player' | 'target'

export interface Stats {
  /** e.g. 0.15 = 15% haste */
  haste: number
  /** e.g. 0.20 = 20% crit chance */
  critChance: number
  critMult: number
}

export interface ActiveAura {
  defId: string
  unit: Unit
  appliedAt: number
  expiresAt: number
  stacks: number
  nextTickAt?: number
  tickInterval?: number
  /** scratch values a spec can attach (e.g. snapshot multipliers) */
  data: Record<string, number>
}

export interface AuraDef {
  id: string
  name: string
  icon?: string
  /** base duration in seconds; Infinity = until removed */
  duration: number
  maxStacks?: number
  /** refresh extends to duration + min(remaining, 0.3 * duration) */
  pandemic?: boolean
  /** refresh extends to duration + full remaining (SW: Madness-style rollover) */
  rollover?: boolean
  /** show on the target debuff row (DoTs) vs player buff row */
  debuff?: boolean
  tick?: {
    interval: number
    hasted?: boolean
    onTick: (sim: SimAPI, aura: ActiveAura) => void
  }
  onApply?: (sim: SimAPI, aura: ActiveAura) => void
  onExpire?: (sim: SimAPI, aura: ActiveAura) => void
}

export interface ChannelDef {
  duration: number
  ticks: number
  hasted?: boolean
  onTick: (sim: SimAPI, tickIndex: number) => void
}

export interface AbilityDef {
  id: string
  name: string
  icon: string
  spellId?: number
  /** base cast time in seconds; omit for instant */
  castTime?: number
  channel?: ChannelDef
  cooldown?: number
  charges?: number
  offGcd?: boolean
  /** resource cost (dynamic via costMod) */
  cost?: number
  costMod?: (sim: SimAPI) => number
  castTimeMod?: (sim: SimAPI, base: number) => number
  /** return true if usable, or a string reason why not */
  usable?: (sim: SimAPI) => true | string
  /** when true at cast time, this cast does not consume a charge (proc resets) */
  noCooldownIf?: (sim: SimAPI) => boolean
  onCastStart?: (sim: SimAPI) => void
  /** fires when the cast completes (instantly for instants) */
  onResolve: (sim: SimAPI) => void
  tags?: string[]
}

export interface DamageEvent {
  time: number
  spellId: string
  amount: number
}

export interface CastEvent {
  time: number
  abilityId: string
  /** what the oracle policy would have cast from the same state */
  oracleChoice: string | null
  /** seconds the GCD sat idle before this cast started */
  deadTime: number
  insanityBefore: number
  insanityAfter: number
}

export interface SimAPI {
  readonly time: number
  readonly insanity: number
  readonly stats: Stats
  readonly spec: SpecConfig
  /** scratch space for spec-level state (proc counters etc.) */
  data: Record<string, number>

  rng(stream: string): number
  hasteMult(): number
  gcdLength(): number
  /** schedule a delayed effect (travel time, staggered waves) */
  schedule(at: number, fn: () => void): unknown

  applyAura(unit: Unit, id: string, opts?: { duration?: number; stacks?: number }): ActiveAura
  removeAura(unit: Unit, id: string): void
  aura(unit: Unit, id: string): ActiveAura | undefined
  auraRemains(unit: Unit, id: string): number
  stacks(unit: Unit, id: string): number
  extendAura(unit: Unit, id: string, seconds: number): void
  /** remove one stack; removes the aura at zero */
  consumeStack(unit: Unit, id: string): void

  gain(amount: number, source: string): void
  spend(amount: number): void

  damage(spellId: string, coeff: number, opts?: { canCrit?: boolean; tags?: string[] }): void

  ability(id: string): AbilityDef
  cooldownRemains(abilityId: string): number
  chargesOf(abilityId: string): number
  resetCooldown(abilityId: string): void
  reduceCooldown(abilityId: string, seconds: number): void
  isUsable(abilityId: string): true | string
  timeToUsable(abilityId: string): number

  /** currently casting or channeling */
  readonly casting: { abilityId: string; startedAt: number; finishAt: number; channel: boolean } | null
  readonly gcdReadyAt: number
}

export interface SpecConfig {
  name: string
  specId: string
  resourceName: string
  resourceMax: number
  startingResource?: number
  abilities: AbilityDef[]
  auras: AuraDef[]
  /** default action-bar order */
  actionBar: string[]
  onCombatStart?: (sim: SimAPI) => void
  /** global damage multiplier hook (mastery, buffs) */
  damageMult?: (sim: SimAPI, spellId: string, tags: string[]) => number
  /** additional haste from temporary buffs (fraction, added to base haste) */
  hasteMod?: (sim: SimAPI) => number
  /** the oracle: best ability to press right now, or null to wait */
  policy: (sim: SimAPI) => string | null
  /** should this action-bar button glow (proc highlight)? */
  glows?: (sim: SimAPI, abilityId: string) => boolean
  /** abilities considered near-equivalent picks for grading, e.g. filler vs filler */
  equivalentChoices?: (sim: SimAPI, pressed: string, oracle: string) => boolean
}

export interface SimConfig {
  seed: number
  duration: number
  stats: Stats
}
