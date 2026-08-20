// Deterministic PRNG. Each mechanic gets its own named stream so the number of
// rolls one mechanic makes never shifts another mechanic's sequence — this keeps
// player runs and oracle runs on the same seed roughly proc-comparable even
// though they cast in different orders.

function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export class RngBank {
  private streams = new Map<string, () => number>()
  constructor(private seed: number) {}

  roll(stream: string): number {
    let fn = this.streams.get(stream)
    if (!fn) {
      fn = mulberry32(this.seed ^ hashString(stream))
      this.streams.set(stream, fn)
    }
    return fn()
  }
}
