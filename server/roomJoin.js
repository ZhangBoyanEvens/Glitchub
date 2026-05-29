import { markAppointmentEntered } from './appointmentEntered.js'
import { clerkUserIdFromRequest } from './clerkAuth.js'
import { resolveUserPrimaryEmailLower } from './clerkUserEmail.js'
import {
  ensureInstantParticipant,
  instantJoinResponse,
  isInstantAppointment,
} from './roomAccess.js'
import { purgeStaleUnenteredRooms } from './roomExpire.js'

/**
 * Join a session room by `appointments.room_id`.
 * Caller must be the host (host_id) OR an invitee whose Clerk primary email matches
 * `appointment_participants.email` (invited / accepted; not declined).
 *
 * POST /api/rooms/join
 * Body: { roomId: string }
 */
export function registerRoomJoinRoutes(app, pool) {
  app.post('/api/rooms/join', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const userId = await clerkUserIdFromRequest(req)
    if (!userId) {
      res.status(401).json({ ok: false, message: 'Unauthorized' })
      return
    }

    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId || !roomId.toLowerCase().startsWith('rm_')) {
      res.status(400).json({
        ok: false,
        message: 'Invalid room id (expected rm_…)',
      })
      return
    }

    const userEmail = await resolveUserPrimaryEmailLower(pool, userId)
    if (!userEmail) {
      res.status(403).json({
        ok: false,
        code: 'NO_EMAIL',
        message:
          'Your account has no primary email in Clerk (and no synced row in Neon). Add a verified email to join.',
      })
      return
    }

    try {
      await purgeStaleUnenteredRooms(pool)
    } catch (err) {
      console.warn('[rooms/join] expire sweep:', err?.message ?? err)
    }

    let row
    try {
      const q = await pool.query(
        `SELECT id, host_id, room_id, status, scheduled_at, room_kind, join_code
         FROM appointments
         WHERE lower(trim(room_id)) = lower(trim($1))`,
        [roomId],
      )
      if (!q.rows.length) {
        res.status(404).json({ ok: false, message: 'Room not found' })
        return
      }
      row = q.rows[0]
    } catch (err) {
      console.error('[rooms/join]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (row.status === 'cancelled') {
      res.status(410).json({
        ok: false,
        message: 'This session has been cancelled',
      })
      return
    }

    if (isInstantAppointment(row)) {
      await ensureInstantParticipant(pool, row.id, userEmail)
      await markAppointmentEntered(pool, row.id)
      res.json(instantJoinResponse(row, userId))
      return
    }

    if (row.host_id === userId) {
      await markAppointmentEntered(pool, row.id)
      res.json({
        ok: true,
        role: 'host',
        appointmentId: row.id,
        roomId: row.room_id,
        scheduledAt: row.scheduled_at,
      })
      return
    }

    let pq
    try {
      pq = await pool.query(
        `SELECT status FROM appointment_participants
         WHERE appointment_id = $1 AND lower(trim(email)) = lower(trim($2))`,
        [row.id, userEmail],
      )
    } catch (err) {
      console.error('[rooms/join] participant', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (!pq.rows.length) {
      res.status(403).json({
        ok: false,
        message:
          'Only the host or an invited email address (from the booking) can enter this room.',
      })
      return
    }

    const pst = pq.rows[0].status
    if (pst === 'declined') {
      res.status(403).json({
        ok: false,
        message: 'You previously declined this invite.',
      })
      return
    }

    await markAppointmentEntered(pool, row.id)
    res.json({
      ok: true,
      role: 'invitee',
      participantStatus: pst,
      appointmentId: row.id,
      roomId: row.room_id,
      scheduledAt: row.scheduled_at,
    })
  })
}
