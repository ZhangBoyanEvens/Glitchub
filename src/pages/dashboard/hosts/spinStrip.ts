import type { ReferenceCatalogCategory } from './referenceGamesCatalogApi.ts'
import { createSeededRandom, seededInt } from './seededRandom.ts'
import { REEL_LEN, WIN_INDEX } from './roomCaseMetrics.ts'

export type StripCell = {
  id: number
  title: string
  tier_rank: number
}

function clampTier(t: number): number {
  return Math.min(6, Math.max(1, Math.round(t)))
}

export function flattenPoolDeterministic(categories: ReferenceCatalogCategory[]): StripCell[] {
  const sortedCats = [...categories].sort((a, b) => a.tier_rank - b.tier_rank)
  const out: StripCell[] = []
  for (const c of sortedCats) {
    const tr = clampTier(c.tier_rank)
    const games = [...(c.games ?? [])].sort((a, b) => a.id - b.id)
    for (const g of games) {
      out.push({ id: g.id, title: g.title, tier_rank: tr })
    }
  }
  return out
}

export function buildDeterministicStrip(
  win: StripCell,
  pool: StripCell[],
  seed: number,
): StripCell[] {
  const next = createSeededRandom(seed ^ 0x9e3779b9)
  if (!pool.length) {
    return Array.from({ length: REEL_LEN }, () => ({ ...win }))
  }
  const cells: StripCell[] = []
  for (let i = 0; i < REEL_LEN; i++) {
    if (i === WIN_INDEX) {
      cells.push({ ...win })
    } else {
      const pick = pool[seededInt(next, pool.length)]
      cells.push({ ...pick })
    }
  }
  return cells
}
