import { resolveReferenceGamePrice } from './referenceGamePrices.ts'

export function resolveReferenceGameSteamStoreUrl(game: {
  title?: string | null
}): string | null {
  const price = resolveReferenceGamePrice(game)
  if (!price?.steamAppId) return null
  return `https://store.steampowered.com/app/${price.steamAppId}/`
}
