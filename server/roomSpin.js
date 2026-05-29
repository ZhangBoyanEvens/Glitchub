import {
  resolveAuthorizedRoomContext,
  sendRoomContextError,
} from './roomContext.js'
import { dispatchRoomEvent, EventType } from './roomFsm/roomService.js'
import { spinRowToWsPayload } from './roomFsm/spinEngine.js'

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 */
async function fetchLatestSpinRow(pool, appointmentId) {
  const q = await pool.query(
    `SELECT spin_id, room_id, seed, result_game_id, result_game_title, tier_rank,
            spin_duration_ms, server_timestamp_ms, reveal_timestamp_ms, round_number
     FROM room_spins
     WHERE appointment_id = $1 AND invalidated_at IS NULL
     ORDER BY server_timestamp_ms DESC
     LIMIT 1`,
    [appointmentId],
  )
  return q.rows[0] ?? null
}

/** @deprecated 使用 spinRowToWsPayload */
export function spinRowToEvent(row) {
  return spinRowToWsPayload(row)
}

/**
 * POST /api/rooms/:roomId/spin  — FSM SPIN_STARTED
 * GET  /api/rooms/:roomId/spin/latest
 */
export function registerRoomSpinRoutes(app, pool) {
  app.get('/api/rooms/:roomId/spin/latest', async (req, res) => {
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
      const row = await fetchLatestSpinRow(pool, ctx.appt.id)
      if (!row) {
        res.json({ ok: true, spin: null })
        return
      }
      const event = spinRowToWsPayload(row)
      const now = Date.now()
      res.json({
        ok: true,
        spin: event,
        serverTimestamp: now,
        isComplete: now >= event.revealTimestamp,
      })
    } catch (err) {
      console.error('[rooms/spin/latest]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.post('/api/rooms/:roomId/spin', async (req, res) => {
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
      const result = await dispatchRoomEvent(
        pool,
        {
          appt: ctx.appt,
          userId: ctx.userId,
          isHost: ctx.appt.host_id === ctx.userId,
        },
        EventType.SPIN_STARTED,
      )

      if (!result.ok) {
        const status =
          result.code === 'RATE_LIMITED'
            ? 429
            : result.code === 'FORBIDDEN'
              ? 403
              : result.code === 'INVALID_TRANSITION'
                ? 409
                : 400
        res.status(status).json(result)
        return
      }

      res.status(201).json({ ok: true, ...result.spin })
    } catch (err) {
      console.error('[rooms/spin POST]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
