import type { SpecConfig } from '../engine/types'
import { shadowPriest } from './shadowPriest/spec'
import { shadowPriestVoidweaver } from './shadowPriest/voidweaver'
import { balanceDruid } from './balanceDruid/spec'
import { balanceKeeper } from './balanceDruid/keeperOfTheGrove'
import { elementalShaman } from './elementalShaman/spec'
import { elementalStormbringer } from './elementalShaman/stormbringer'
import { enhancementShaman } from './enhancementShaman/spec'
import { enhancementTotemic } from './enhancementShaman/totemic'
import { unholyDK } from './unholyDK/spec'
import { unholyDKSanlayn } from './unholyDK/sanlayn'
import { frostDK } from './frostDK/spec'
import { frostDKDeathbringer } from './frostDK/deathbringer'
import { frostMage } from './frostMage/spec'
import { frostMageFrostfire } from './frostMage/frostfire'
import { fireMage } from './fireMage/spec'
import { fireMageFrostfire } from './fireMage/frostfire'
import { arcaneMage } from './arcaneMage/spec'
import { arcaneMageSpellslinger } from './arcaneMage/spellslinger'
import { feralDruid } from './feralDruid/spec'
import { feralClaw } from './feralDruid/druidOfTheClaw'
import { havocDH } from './havocDH/spec'
import { havocFelScarred } from './havocDH/felScarred'
import { devourerDH } from './devourerDH/spec'
import { devourerAnnihilator } from './devourerDH/annihilator'
import { devastationEvoker } from './devastationEvoker/spec'
import { devastationFlameshaper } from './devastationEvoker/flameshaper'
import { augmentationEvoker } from './augmentationEvoker/spec'
import { augmentationScalecommander } from './augmentationEvoker/scalecommander'
import { bmHunter } from './bmHunter/spec'
import { bmDarkRanger } from './bmHunter/darkRanger'
import { mmHunter } from './mmHunter/spec'
import { mmDarkRanger } from './mmHunter/darkRanger'
import { survivalHunter } from './survivalHunter/spec'
import { survivalPackLeader } from './survivalHunter/packLeader'
import { windwalkerMonk } from './windwalkerMonk/spec'
import { windwalkerConduit } from './windwalkerMonk/conduit'
import { retPaladin } from './retPaladin/spec'
import { retHerald } from './retPaladin/herald'
import { assassinationRogue } from './assassinationRogue/spec'
import { assassinationFatebound } from './assassinationRogue/fatebound'
import { outlawRogue } from './outlawRogue/spec'
import { outlawFatebound } from './outlawRogue/fatebound'
import { subtletyRogue } from './subtletyRogue/spec'
import { subtletyTrickster } from './subtletyRogue/trickster'
import { afflictionWarlock } from './afflictionWarlock/spec'
import { afflictionHellcaller } from './afflictionWarlock/hellcaller'
import { demonologyWarlock } from './demonologyWarlock/spec'
import { demonologySoulHarvester } from './demonologyWarlock/soulHarvester'
import { destructionWarlock } from './destructionWarlock/spec'
import { destructionDiabolist } from './destructionWarlock/diabolist'
import { armsWarrior } from './armsWarrior/spec'
import { armsColossus } from './armsWarrior/colossus'
import { furyWarrior } from './furyWarrior/spec'
import { furyMountainThane } from './furyWarrior/mountainThane'

// every registered build; per spec the guide-recommended build comes first
// (the first variant of a specId is the default the app loads)
export const specs: SpecConfig[] = [
  shadowPriest, shadowPriestVoidweaver,
  balanceDruid, balanceKeeper,
  elementalShaman, elementalStormbringer,
  enhancementShaman, enhancementTotemic,
  unholyDK, unholyDKSanlayn,
  frostDK, frostDKDeathbringer,
  frostMage, frostMageFrostfire,
  fireMage, fireMageFrostfire,
  arcaneMage, arcaneMageSpellslinger,
  feralDruid, feralClaw,
  havocDH, havocFelScarred,
  devourerDH, devourerAnnihilator,
  devastationEvoker, devastationFlameshaper,
  augmentationEvoker, augmentationScalecommander,
  bmHunter, bmDarkRanger,
  mmHunter, mmDarkRanger,
  survivalHunter, survivalPackLeader,
  windwalkerMonk, windwalkerConduit,
  retPaladin, retHerald,
  assassinationRogue, assassinationFatebound,
  outlawRogue, outlawFatebound,
  subtletyRogue, subtletyTrickster,
  afflictionWarlock, afflictionHellcaller,
  demonologyWarlock, demonologySoulHarvester,
  destructionWarlock, destructionDiabolist,
  armsWarrior, armsColossus,
  furyWarrior, furyMountainThane,
]

/** stable id for a build of a spec (explicit buildId, else hero-talent slug) */
export function buildIdOf(spec: SpecConfig): string {
  return spec.buildId
    ?? (spec.source?.heroTalent ?? 'default').toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

/** all registered builds of a spec; the first one is the default */
export function specVariants(specId: string): SpecConfig[] {
  return specs.filter(s => s.specId === specId)
}

export function specById(id: string, buildId?: string): SpecConfig | undefined {
  const variants = specVariants(id)
  if (!variants.length) return undefined
  if (!buildId) return variants[0]
  return variants.find(v => buildIdOf(v) === buildId) ?? variants[0]
}
