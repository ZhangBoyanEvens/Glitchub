import { markAppointmentEntered } from './appointmentEntered.js'
import { recordSessionJoined } from './reputation/reputationService.js'
import {
  resolveAuthorizedRoomContext,
  sendRoomContextError,
} from './roomContext.js'

/**
 * 房间在线态心跳；成员列表见 GET /api/rooms/:roomId/live
 *
 * POST /api/rooms/:roomId/presence
 * DELETE /api/rooms/:roomId/presence
 */
export function registerRoomMembersRoutes(app, pool) {
  app.post('/api/rooms/:roomId/presence', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const roomId = decodeURIComponent(String(req.params.roomId ?? '')).trim()
    if (!roomId || !roomId.toLowerCase().startsWith('rm_')) {
      res.status(400).json({
        ok: false,
        message: 'Invalid room id (expected rm_…)',
      })
      return
    }

    const ctx = await resolveAuthorizedRoomContext(pool, req, roomId)
    if (!ctx.ok) {
      sendRoomContextError(res, ctx)
      return
    }

    try {
      await pool.query(
        `INSERT INTO room_presence (appointment_id, clerk_user_id, last_seen_at)
         VALUES ($1, $2, now())
         ON CONFLICT (appointment_id, clerk_user_id)
         DO UPDATE SET last_seen_at = now()`,
        [ctx.appt.id, ctx.userId],
      )
      void markAppointmentEntered(pool, ctx.appt.id)
      void recordSessionJoined(pool, ctx.appt, ctx.userId)
    } catch (err) {
      console.error('[rooms/presence] upsert', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    res.json({ ok: true })
  })

  app.delete('/api/rooms/:roomId/presence', async (req, res) => {
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
      await pool.query(
        `DELETE FROM room_presence WHERE appointment_id = $1 AND clerk_user_id = $2`,
        [ctx.appt.id, ctx.userId],
      )
      await pool.query(
        `DELETE FROM room_player_ready WHERE appointment_id = $1 AND clerk_user_id = $2`,
        [ctx.appt.id, ctx.userId],
      )
    } catch (err) {
      console.error('[rooms/presence DELETE]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    res.json({ ok: true })
  })
}
