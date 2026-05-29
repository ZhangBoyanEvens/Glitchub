/** 与前端 roomCaseProbability.ts 对齐 */

export const CD_TIER_GAME_PROBABILITY = 0.0005
export const WISH_POOL_SLOT_BOOST = 1.5

/**
 * @param {{ tierRank: number, tierLabel: string }} row
 */
export function isCdTierRow(row) {
  if (row.tierRank === 6) return true
  return String(row.tierLabel).includes('CD期')
}

/**
 * @param {Array<{ id: number, title: string, tierRank: number, tierLabel: string, probability: number, wishSlotCount?: number }>} rows
 */
export function applyCdTierProbabilityCap(rows) {
  if (!rows.length) return rows
  const cdIdx = []
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
  for (const i of otherIdx) {
    next[i].probability += (next[i].probability / otherSum) * delta
  }
  return next
}

/**
 * @param {Array<{ id: number, tier_rank: number, label_zh: string, display_name_zh: string, tier_pick_weight: number, games: Array<{ id: number, title: string }> }>} categories
 */
export function buildGameProbabilityRows(categories) {
  const rows = []
  const sumWeight = categories.reduce((acc, c) => acc + Number(c.tier_pick_weight), 0)

  for (const c of categories) {
    const games = c.games ?? []
    const n = games.length || 1
    const tierNorm = Number(c.tier_pick_weight) / sumWeight
    const withinTierShare = 1 / n
    const tierLabel = c.display_name_zh || c.label_zh || `T${c.tier_rank}`

    for (const g of games) {
      rows.push({
        id: g.id,
        title: g.title,
        tierRank: c.tier_rank,
        tierLabel,
        probability: tierNorm * withinTierShare,
      })
    }
  }

  rows.sort((a, b) => {
    if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank
    return a.id - b.id
  })

  return applyCdTierProbabilityCap(rows)
}

/**
 * @param {ReturnType<typeof buildGameProbabilityRows>} base
 * @param {number[]} wishGameIds
 */
export function applyWishPoolBoost(base, wishGameIds) {
  const boostIds = wishGameIds.filter((id) => id > 0)
  if (!boostIds.length) return base

  let sum = 0
  const weighted = base.map((row) => {
    let mult = 1
    for (const id of boostIds) {
      if (id === row.id) mult *= WISH_POOL_SLOT_BOOST
    }
    const w = row.probability * mult
    sum += w
    return { ...row, probability: w }
  })

  if (sum <= 0) return base
  return weighted.map((row) => ({
    ...row,
    probability: row.probability / sum,
  }))
}

/**
 * @param {Array<{ id: number, title: string, tierRank: number, probability: number }>} rows
 * @param {() => number} next
 */
export function pickGameFromRowsSeeded(rows, next) {
  if (!rows.length) {
    return { id: 0, title: '?', tier_rank: 1 }
  }
  const sum = rows.reduce((s, r) => s + r.probability, 0)
  if (sum <= 0) {
    const r = rows[0]
    return { id: r.id, title: r.title, tier_rank: r.tierRank }
  }
  let roll = next() * sum
  for (const row of rows) {
    roll -= row.probability
    if (roll < 0) {
      return { id: row.id, title: row.title, tier_rank: row.tierRank }
    }
  }
  const last = rows[rows.length - 1]
  return { id: last.id, title: last.title, tier_rank: last.tierRank }
}
