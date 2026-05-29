import type { ReferenceCatalogCategory } from './referenceGamesCatalogApi.ts'
import {
  buildGameProbabilityRows,
  type GameProbabilityRow,
} from './roomCaseProbability.ts'

/** 每个许愿位使对应游戏权重 ×1.5（可叠加） */
export const WISH_POOL_SLOT_BOOST = 1.5

export function wishBoostMultiplierForGame(
  gameId: number,
  wishGameIds: number[],
): number {
  if (!wishGameIds.length) return 1
  let mult = 1
  for (const id of wishGameIds) {
    if (id === gameId) mult *= WISH_POOL_SLOT_BOOST
  }
  return mult
}

export function countWishSlotsForGame(gameId: number, wishGameIds: number[]): number {
  return wishGameIds.filter((id) => id === gameId).length
}

export function buildGameProbabilityRowsWithWishPool(
  categories: ReferenceCatalogCategory[],
  wishGameIds: number[],
): GameProbabilityRow[] {
  const base = buildGameProbabilityRows(categories)
  const boostIds = wishGameIds.filter((id) => id > 0)
  if (!boostIds.length) return base

  let sum = 0
  const weighted = base.map((row) => {
    const boost = wishBoostMultiplierForGame(row.id, boostIds)
    const w = row.probability * boost
    sum += w
    return {
      ...row,
      probability: w,
      wishSlotCount: countWishSlotsForGame(row.id, boostIds),
    }
  })

  if (sum <= 0) return base
  return weighted.map((row) => ({
    ...row,
    probability: row.probability / sum,
  }))
}

export type WeightedGamePick = {
  id: number
  title: string
  tier_rank: number
}

/** 按公示后的归一化概率抽样（许愿池生效时使用） */
export function pickGameFromProbabilityRows(
  rows: GameProbabilityRow[],
): WeightedGamePick {
  if (!rows.length) {
    return { id: 0, title: '?', tier_rank: 1 }
  }
  const sum = rows.reduce((s, r) => s + r.probability, 0)
  if (sum <= 0) {
    const r = rows[0]
    return { id: r.id, title: r.title, tier_rank: r.tierRank }
  }
  let roll = Math.random() * sum
  for (const row of rows) {
    roll -= row.probability
    if (roll < 0) {
      return { id: row.id, title: row.title, tier_rank: row.tierRank }
    }
  }
  const last = rows[rows.length - 1]
  return { id: last.id, title: last.title, tier_rank: last.tierRank }
}
