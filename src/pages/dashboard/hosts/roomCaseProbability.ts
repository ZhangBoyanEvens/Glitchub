import type { ReferenceCatalogCategory } from './referenceGamesCatalogApi.ts'

/** CD 期（第 6 档）每个游戏固定中奖概率 */
export const CD_TIER_GAME_PROBABILITY = 0.0005

export type GameProbabilityRow = {
  id: number
  title: string
  tierRank: number
  tierLabel: string
  probability: number
  /** 许愿池占位次数（保存后生效） */
  wishSlotCount?: number
}

export function isCdTierRow(row: Pick<GameProbabilityRow, 'tierRank' | 'tierLabel'>): boolean {
  if (row.tierRank === 6) return true
  return row.tierLabel.includes('CD期')
}

/**
 * CD 期每款固定 0.05%；从 CD 期减下来的概率按原比例分给其余游戏。
 */
export function applyCdTierProbabilityCap(rows: GameProbabilityRow[]): GameProbabilityRow[] {
  if (!rows.length) return rows

  const cdIdx: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (isCdTierRow(rows[i])) cdIdx.push(i)
  }
  if (!cdIdx.length) return rows

  const cap = CD_TIER_GAME_PROBABILITY
  const next = rows.map((r) => ({ ...r }))

  let cdBefore = 0
  for (const i of cdIdx) cdBefore += next[i].probability
  const cdAfter = cdIdx.length * cap
  const delta = cdBefore - cdAfter

  for (const i of cdIdx) next[i].probability = cap

  if (Math.abs(delta) < 1e-15) return next

  const otherIdx = next.map((_, i) => i).filter((i) => !cdIdx.includes(i))
  const otherSum = otherIdx.reduce((s, i) => s + next[i].probability, 0)

  if (otherSum <= 0) {
    const share = delta / otherIdx.length
    for (const i of otherIdx) next[i].probability += share
    return next
  }

  if (delta > 0) {
    for (const i of otherIdx) {
      next[i].probability += delta * (next[i].probability / otherSum)
    }
    return next
  }

  const take = -delta
  for (const i of otherIdx) {
    next[i].probability = Math.max(0, next[i].probability - take * (next[i].probability / otherSum))
  }
  const total = next.reduce((s, r) => s + r.probability, 0)
  if (total <= 0) return next
  return next.map((r) => ({ ...r, probability: r.probability / total }))
}

export function buildGameProbabilityRows(
  categories: ReferenceCatalogCategory[],
): GameProbabilityRow[] {
  const rows: GameProbabilityRow[] = []
  const sorted = [...categories].sort((a, b) => a.tier_rank - b.tier_rank)
  const sumWeight = sorted.reduce(
    (s, c) => s + (Number.isFinite(c.tier_pick_weight) ? c.tier_pick_weight : 0),
    0,
  )

  for (const c of sorted) {
    const games = c.games ?? []
    if (!games.length) continue
    const tierLabel =
      c.display_name_zh?.trim() ||
      c.label_zh?.trim() ||
      `T${c.tier_rank}`
    const tierNorm =
      c.tier_normalized_probability != null && Number.isFinite(c.tier_normalized_probability)
        ? c.tier_normalized_probability
        : sumWeight > 0
          ? c.tier_pick_weight / sumWeight
          : 0
    const withinShare = 1 / games.length
    for (const g of games) {
      const p =
        g.approx_pick_probability != null && Number.isFinite(g.approx_pick_probability)
          ? g.approx_pick_probability
          : tierNorm * withinShare
      if (!Number.isFinite(p) || p <= 0) continue
      rows.push({
        id: g.id,
        title: g.title,
        tierRank: c.tier_rank,
        tierLabel,
        probability: p,
      })
    }
  }

  rows.sort((a, b) => {
    if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank
    return b.probability - a.probability || a.title.localeCompare(b.title, 'en')
  })
  return applyCdTierProbabilityCap(rows)
}

export function formatProbabilityPercent(p: number): string {
  if (p >= 0.01) return `${(p * 100).toFixed(2)}%`
  if (p >= 0.0001) return `${(p * 100).toFixed(4)}%`
  return `${(p * 100).toFixed(6)}%`
}
