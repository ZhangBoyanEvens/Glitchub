import { randomBytes } from 'node:crypto'
import { markAppointmentEntered } from './appointmentEntered.js'
import { clerkUserIdFromRequest } from './clerkAuth.js'
import { resolveUserPrimaryEmailLower } from './clerkUserEmail.js'
import {
  ensureInstantParticipant,
  findOrCreateInstantAppointment,
  instantJoinResponse,
  normalizeInstantJoinCode,
  ROOM_KIND_INSTANT,
} from './roomAccess.js'
import { purgeEmptyInstantRooms } from './roomExpire.js'

/**
 * POST /api/rooms/instant/enter
 * Body: { joinCode: string } — 4–6 位数字，面对面约定同一码进同一房间；首个创建者为房主。
 */
export function registerRoomInstantRoutes(app, pool) {
  app.post('/api/rooms/instant/enter', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const userId = await clerkUserIdFromRequest(req)
    if (!userId) {
      res.status(401).json({ ok: false, message: 'Unauthorized' })
      return
    }

    const joinCode = normalizeInstantJoinCode(req.body?.joinCode)
    if (!joinCode) {
      res.status(400).json({ ok: false, message: 'INVALID_JOIN_CODE' })
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
      await purgeEmptyInstantRooms(pool)
    } catch (err) {
      console.warn('[rooms/instant/enter] empty sweep:', err?.message ?? err)
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const appt = await findOrCreateInstantAppointment(client, userId, joinCode)
      await ensureInstantParticipant(client, appt.id, userEmail)
      await client.query('COMMIT')

      await markAppointmentEntered(pool, appt.id)
      res.json(instantJoinResponse(appt, userId))
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[rooms/instant/enter]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      client.release()
    }
  })

  /** 随机 6 位码，供大厅「生成房间码」 */
  app.post('/api/rooms/instant/suggest-code', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const userId = await clerkUserIdFromRequest(req)
    if (!userId) {
      res.status(401).json({ ok: false, message: 'Unauthorized' })
      return
    }

    for (let attempt = 0; attempt < 8; attempt++) {
      const joinCode = String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, '0')
      const q = await pool.query(
        `SELECT 1 FROM appointments
         WHERE room_kind = $1 AND join_code = $2 AND status <> 'cancelled'
         LIMIT 1`,
        [ROOM_KIND_INSTANT, joinCode],
      )
      if (!q.rows.length) {
        res.json({ ok: true, joinCode })
        return
      }
    }

    res.status(503).json({ ok: false, message: 'Could not allocate join code' })
  })
}
