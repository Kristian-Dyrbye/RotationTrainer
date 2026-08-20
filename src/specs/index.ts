import type { SpecConfig } from '../engine/types'
import { shadowPriest } from './shadowPriest/spec'
import { balanceDruid } from './balanceDruid/spec'
import { elementalShaman } from './elementalShaman/spec'
import { unholyDK } from './unholyDK/spec'
import { frostDK } from './frostDK/spec'

export const specs: SpecConfig[] = [
  shadowPriest,
  balanceDruid,
  elementalShaman,
  unholyDK,
  frostDK,
]

export function specById(id: string): SpecConfig | undefined {
  return specs.find(s => s.specId === id)
}
