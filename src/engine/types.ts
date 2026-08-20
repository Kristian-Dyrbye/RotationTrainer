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
  /** current display name/icon when a proc transforms the button (MF: Insanity style) */
  displayName?: (sim: SimAPI) => string
  displayIcon?: (sim: SimAPI) => string
  /** extra stack badge on the button (proc charges), shown when > 0 */
  displayStacks?: (sim: SimAPI) => number
  /** base cast time in seconds; omit for instant */
  castTime?: number
  /** static, or resolved at cast start for proc-transformed channels */
  channel?: ChannelDef | ((sim: SimAPI) => ChannelDef)
  cooldown?: number
  charges?: number
  offGcd?: boolean
  /** resource cost (dynamic via costMod) */
  cost?: number
  costMod?: (sim: SimAPI) => number
  /** runes spent (specs with a rune pool) */
  runeCost?: number
  runeCostMod?: (sim: SimAPI) => number
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

  /** rune pool (0 everywhere when the spec has no runes) */
  runesReady(): number
  /** seconds until the next rune comes back (0 if one is ready) */
  nextRuneIn(): number
  /** instantly restore the rune closest to coming back (Runic Empowerment-style) */
  refundRune(): void

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
  /** icon for the spec badge / picker */
  specIcon?: string
  resourceName: string
  resourceMax: number
  startingResource?: number
  /** secondary recharging pool (DK runes); rechargeTime is hasted */
  runes?: { max: number; rechargeTime: number }
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
  /** human-readable priority list mirroring `policy`, for display */
  priorityList?: PriorityRow[]
  /** should this action-bar button glow (proc highlight)? */
  glows?: (sim: SimAPI, abilityId: string) => boolean
  /** abilities considered near-equivalent picks for grading, e.g. filler vs filler */
  equivalentChoices?: (sim: SimAPI, pressed: string, oracle: string) => boolean
}

export interface SimConfig {
  seed: number
  duration: number
  stats: Stats
  /** Bloodlust/Heroism from combat start: +30% haste for 40s */
  lustOnPull?: boolean
}

export interface PriorityRow {
  abilityId: string
  text: string
  /** display overrides for transformed-button rows (e.g. Void Volley on the Voidform button) */
  label?: string
  icon?: string
  /** condition for live-hint highlighting (matched against the oracle's pick) */
  when?: (sim: SimAPI) => boolean
}
