import type { SpecConfig } from '../engine/types'
import { shadowPriest } from './shadowPriest/spec'
import { balanceDruid } from './balanceDruid/spec'
import { elementalShaman } from './elementalShaman/spec'
import { unholyDK } from './unholyDK/spec'
import { frostDK } from './frostDK/spec'
import { frostMage } from './frostMage/spec'
import { fireMage } from './fireMage/spec'
import { arcaneMage } from './arcaneMage/spec'
import { feralDruid } from './feralDruid/spec'
import { havocDH } from './havocDH/spec'
import { devourerDH } from './devourerDH/spec'
import { devastationEvoker } from './devastationEvoker/spec'
import { augmentationEvoker } from './augmentationEvoker/spec'
import { bmHunter } from './bmHunter/spec'
import { mmHunter } from './mmHunter/spec'
import { survivalHunter } from './survivalHunter/spec'
import { windwalkerMonk } from './windwalkerMonk/spec'
import { retPaladin } from './retPaladin/spec'
import { assassinationRogue } from './assassinationRogue/spec'
import { outlawRogue } from './outlawRogue/spec'
import { subtletyRogue } from './subtletyRogue/spec'
import { afflictionWarlock } from './afflictionWarlock/spec'
import { demonologyWarlock } from './demonologyWarlock/spec'
import { destructionWarlock } from './destructionWarlock/spec'
import { armsWarrior } from './armsWarrior/spec'
import { furyWarrior } from './furyWarrior/spec'

export const specs: SpecConfig[] = [
  shadowPriest,
  balanceDruid,
  elementalShaman,
  unholyDK,
  frostDK,
  frostMage,
  fireMage,
  arcaneMage,
  feralDruid,
  havocDH,
  devourerDH,
  devastationEvoker,
  augmentationEvoker,
  bmHunter,
  mmHunter,
  survivalHunter,
  windwalkerMonk,
  retPaladin,
  assassinationRogue,
  outlawRogue,
  subtletyRogue,
  afflictionWarlock,
  demonologyWarlock,
  destructionWarlock,
  armsWarrior,
  furyWarrior,
]

export function specById(id: string): SpecConfig | undefined {
  return specs.find(s => s.specId === id)
}
