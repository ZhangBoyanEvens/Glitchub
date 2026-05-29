import {
  resolveAuthorizedRoomContext,
  sendRoomContextError,
} from './roomContext.js'
import { dispatchRoomEvent, EventType } from './roomFsm/roomService.js'

const WISH_POOL_NONE_ID = 0

/**
 * @param {import('pg').Pool} pool
 * @param {(number|null)[]} rawSlotIds
 */
async function buildWishPoolGamesResponse(pool, rawSlotIds) {
  const gameIds = rawSlotIds.map((id) =>
    id == null || Number(id) === 0 ? WISH_POOL_NONE_ID : Number(id),
  )
  const realIds = gameIds.filter((id) => id > 0)
  /** @type {Map<number, string>} */
  const byId = new Map()
  if (realIds.length) {
    const q = await pool.query(
      `SELECT id, title FROM reference_games WHERE id = ANY($1::int[])`,
      [realIds],
    )
    for (const r of q.rows) byId.set(r.id, r.title)
  }
  return {
    gameIds,
    games: gameIds.map((id) =>
      id === WISH_POOL_NONE_ID
        ? { id: WISH_POOL_NONE_ID, title: 'None' }
        : { id, title: byId.get(id) ?? `game#${id}` },
    ),
  }
}

/**
 * GET /api/rooms/:roomId/wish-pool
 * PUT /api/rooms/:roomId/wish-pool  body: { gameIds: number[3] }
 */
export function registerRoomWishPoolRoutes(app, pool) {
  app.get('/api/rooms/:roomId/wish-pool', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const roomId = decodeURIComponent(String(req.params.roomId ?? '')).trim()
    if (!roomId || !roomId.toLowerCase().startsWith('rm_')) {
      res.status(400).json({ ok: false, message: 'Invalid room id (expected rm_…)' })
      return
    }

    const ctx = await resolveAuthorizedRoomContext(pool, req, roomId)
    if (!ctx.ok) {
      sendRoomContextError(res, ctx)
      return
    }

    try {
      const q = await pool.query(
        `SELECT slot1_game_id, slot2_game_id, slot3_game_id, updated_at
         FROM room_wish_pool WHERE appointment_id = $1`,
        [ctx.appt.id],
      )
      if (!q.rows.length) {
        res.json({ ok: true, wishPool: null })
        return
      }
      const row = q.rows[0]
      const payload = await buildWishPoolGamesResponse(pool, [
        row.slot1_game_id,
        row.slot2_game_id,
        row.slot3_game_id,
      ])
      res.json({
        ok: true,
        wishPool: {
          ...payload,
          updatedAt: row.updated_at,
        },
      })
    } catch (err) {
      if (err && String(err.code) === '42P01') {
        res.json({ ok: true, wishPool: null })
        return
      }
      console.error('[rooms/wish-pool GET] query', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.put('/api/rooms/:roomId/wish-pool', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const roomId = decodeURIComponent(String(req.params.roomId ?? '')).trim()
    if (!roomId || !roomId.toLowerCase().startsWith('rm_')) {
      res.status(400).json({ ok: false, message: 'Invalid room id (expected rm_…)' })
      return
    }

    const raw = req.body?.gameIds
    if (!Array.isArray(raw) || raw.length !== 3) {
      res.status(400).json({
        ok: false,
        message: 'gameIds must be an array of exactly 3 game ids',
      })
      return
    }

    const gameIds = raw.map((x) => Number(x))
    if (gameIds.some((id) => !Number.isInteger(id) || id < 0)) {
      res.status(400).json({ ok: false, message: 'Invalid game id in gameIds' })
      return
    }

    const ctx = await resolveAuthorizedRoomContext(pool, req, roomId)
    if (!ctx.ok) {
      sendRoomContextError(res, ctx)
      return
    }

    try {
      const result = await dispatchRoomEvent(
        pool,
        {
          appt: ctx.appt,
          userId: ctx.userId,
          isHost: ctx.appt.host_id === ctx.userId,
        },
        EventType.WISHLIST_UPDATED,
        { gameIds },
      )
      if (!result.ok) {
        res.status(result.code === 'INVALID_TRANSITION' ? 409 : 400).json(result)
        return
      }
      const payload = await buildWishPoolGamesResponse(pool, gameIds)
      res.json({
        ok: true,
        wishPool: { ...payload, updatedAt: new Date().toISOString() },
      })
    } catch (err) {
      console.error('[rooms/wish-pool PUT]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
