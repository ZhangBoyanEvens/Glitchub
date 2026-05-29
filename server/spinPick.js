import { createSeededRandom } from './seededRandom.js'
import {
  applyWishPoolBoost,
  buildGameProbabilityRows,
  pickGameFromRowsSeeded,
} from './spinProbability.js'

/**
 * @param {import('pg').Pool} pool
 */
export async function loadCatalogCategories(pool) {
  const { rows: catRows } = await pool.query(
    `SELECT id, tier_rank, label_zh, display_name_zh, tier_pick_weight::float8 AS tier_pick_weight
     FROM reference_game_categories
     ORDER BY tier_rank`,
  )
  const { rows: gameRows } = await pool.query(
    `SELECT id, category_id, sort_order, title
     FROM reference_games
     ORDER BY category_id, sort_order, id`,
  )

  const gamesByCategory = new Map()
  for (const g of gameRows) {
    const list = gamesByCategory.get(g.category_id) ?? []
    list.push({ id: g.id, title: g.title })
    gamesByCategory.set(g.category_id, list)
  }

  return catRows.map((c) => ({
    ...c,
    games: gamesByCategory.get(c.id) ?? [],
  }))
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 */
export async function loadWishGameIds(pool, appointmentId) {
  try {
    const q = await pool.query(
      `SELECT slot1_game_id, slot2_game_id, slot3_game_id
       FROM room_wish_pool WHERE appointment_id = $1`,
      [appointmentId],
    )
    if (!q.rows.length) return [0, 0, 0]
    const row = q.rows[0]
    return [
      row.slot1_game_id == null ? 0 : Number(row.slot1_game_id),
      row.slot2_game_id == null ? 0 : Number(row.slot2_game_id),
      row.slot3_game_id == null ? 0 : Number(row.slot3_game_id),
    ]
  } catch {
    return [0, 0, 0]
  }
}

/**
 * 服务端权威抽奖（seed 决定结果，与客户端动画共用同一 seed）。
 *
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 * @param {number} seed
 */
export async function pickSpinResult(pool, appointmentId, seed) {
  const categories = await loadCatalogCategories(pool)
  if (!categories.length) {
    throw new Error('Empty catalog')
  }
  const wishIds = await loadWishGameIds(pool, appointmentId)
  const base = buildGameProbabilityRows(categories)
  const rows = applyWishPoolBoost(base, wishIds)
  const next = createSeededRandom(seed)
  return pickGameFromRowsSeeded(rows, next)
}
