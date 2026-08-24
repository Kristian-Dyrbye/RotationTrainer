import { describe, expect, it } from 'vitest'
import { specs, buildIdOf } from './index'
import { conformanceSuite } from './conformance'

describe('spec registry', () => {
  it('has a unique (specId, buildId) per registered build', () => {
    const seen = new Set<string>()
    for (const s of specs) {
      const key = `${s.specId}::${buildIdOf(s)}`
      expect(seen.has(key), key).toBe(false)
      seen.add(key)
    }
  })
})

// every registered spec build must pass the same conformance battery
for (const spec of specs) {
  conformanceSuite(spec)
}
