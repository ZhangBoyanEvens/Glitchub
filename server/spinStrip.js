import { createSeededRandom, seededInt } from './seededRandom.js'

export const REEL_LEN = 56
export const WIN_INDEX = 44

/**
 * 确定性 flatten（排序保证各端一致）
 *
 * @param {Array<{ tier_rank: number, games: Array<{ id: number, title: string }> }>} categories
 */
export function flattenPoolDeterministic(categories) {
  const sortedCats = [...categories].sort((a, b) => a.tier_rank - b.tier_rank)
  const out = []
  for (const c of sortedCats) {
    const tr = Math.min(6, Math.max(1, Math.round(c.tier_rank)))
    const games = [...(c.games ?? [])].sort((a, b) => a.id - b.id)
    for (const g of games) {
      out.push({ id: g.id, title: g.title, tier_rank: tr })
    }
  }
  return out
}

/**
 * @param {{ id: number, title: string, tier_rank: number }} win
 * @param {Array<{ id: number, title: string, tier_rank: number }>} pool
 * @param {number} seed
 */
export function buildDeterministicStrip(win, pool, seed) {
  const next = createSeededRandom(seed ^ 0x9e3779b9)
  if (!pool.length) {
    return Array.from({ length: REEL_LEN }, () => ({ ...win }))
  }
  const cells = []
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
