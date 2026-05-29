import { clerkUserIdFromRequest } from './clerkAuth.js'
import { resolveUserPrimaryEmailLower } from './clerkUserEmail.js'
import {
  fetchAppointmentByRoom,
  userMayAccessRoom,
} from './roomAccess.js'

/**
 * @param {import('pg').Pool} pool
 * @param {string} clerkUserId
 */
async function displayIdForClerkUser(pool, clerkUserId) {
  try {
    const q = await pool.query(
      `SELECT username, first_name, last_name, primary_email, clerk_user_id
       FROM clerk_synced_users WHERE clerk_user_id = $1`,
      [clerkUserId],
    )
    if (q.rows.length) {
      const row = q.rows[0]
      const u = row.username?.trim()
      if (u) return u
      const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
      if (name) return name
      const em = row.primary_email?.trim()
      if (em) return em.split('@')[0] || em
    }
  } catch {
    /* clerk_synced_users 可能不存在 */
  }
  return clerkUserId?.slice(0, 10) ?? 'user'
}

/**
 * GET /api/rooms/:roomId/draw-logs
 * POST /api/rooms/:roomId/draw-logs  body: { gameId?, gameTitle, tierRank }
 * DELETE /api/rooms/:roomId/draw-logs  — 清空本房间全部记录
 */
export function registerRoomCaseDrawLogRoutes(app, pool) {
  app.get('/api/rooms/:roomId/draw-logs', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const userId = await clerkUserIdFromRequest(req)
    if (!userId) {
      res.status(401).json({ ok: false, message: 'Unauthorized' })
      return
    }

    const roomId = decodeURIComponent(String(req.params.roomId ?? '')).trim()
    if (!roomId || !roomId.toLowerCase().startsWith('rm_')) {
      res.status(400).json({ ok: false, message: 'Invalid room id (expected rm_…)' })
      return
    }

    const userEmail = await resolveUserPrimaryEmailLower(pool, userId)
    if (!userEmail) {
      res.status(403).json({ ok: false, message: 'NO_EMAIL' })
      return
    }

    let appt
    try {
      appt = await fetchAppointmentByRoom(pool, roomId)
    } catch (err) {
      console.error('[rooms/draw-logs GET]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (!appt) {
      res.status(404).json({ ok: false, message: 'Room not found' })
      return
    }
    if (appt.status === 'cancelled') {
      res.status(410).json({ ok: false, message: 'This session has been cancelled' })
      return
    }

    let allowed
    try {
      allowed = await userMayAccessRoom(pool, userId, userEmail, appt)
    } catch (err) {
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (!allowed) {
      res.status(403).json({ ok: false, message: 'Forbidden' })
      return
    }

    try {
      const { rows } = await pool.query(
        `SELECT l.id, l.clerk_user_id, l.game_id, l.game_title, l.tier_rank, l.created_at,
                u.username, u.first_name, u.last_name, u.primary_email
         FROM room_case_draw_logs l
         LEFT JOIN clerk_synced_users u ON u.clerk_user_id = l.clerk_user_id
         WHERE l.appointment_id = $1
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT 120`,
        [appt.id],
      )

      const logs = rows.map((r) => {
        const u = r.username?.trim()
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
        const em = r.primary_email?.trim()
        const displayId =
          u || name || (em ? em.split('@')[0] : '') || r.clerk_user_id?.slice(0, 10) || 'user'
        return {
          id: String(r.id),
          clerkUserId: r.clerk_user_id,
          displayId,
          gameId: r.game_id ?? null,
          gameTitle: r.game_title,
          tierRank: Number(r.tier_rank),
          createdAt: r.created_at,
        }
      })

      res.json({ ok: true, logs })
    } catch (err) {
      if (err && String(err.code) === '42P01') {
        res.json({ ok: true, logs: [] })
        return
      }
      console.error('[rooms/draw-logs GET] query', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.post('/api/rooms/:roomId/draw-logs', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const userId = await clerkUserIdFromRequest(req)
    if (!userId) {
      res.status(401).json({ ok: false, message: 'Unauthorized' })
      return
    }

    const roomId = decodeURIComponent(String(req.params.roomId ?? '')).trim()
    if (!roomId || !roomId.toLowerCase().startsWith('rm_')) {
      res.status(400).json({ ok: false, message: 'Invalid room id (expected rm_…)' })
      return
    }

    const gameTitle = String(req.body?.gameTitle ?? '').trim()
    const tierRank = Number(req.body?.tierRank)
    const gameIdRaw = req.body?.gameId
    const gameId =
      gameIdRaw === null || gameIdRaw === undefined || gameIdRaw === ''
        ? null
        : Number(gameIdRaw)

    if (!gameTitle || !Number.isFinite(tierRank) || tierRank < 1 || tierRank > 6) {
      res.status(400).json({
        ok: false,
        message: 'gameTitle and tierRank (1–6) are required',
      })
      return
    }

    const userEmail = await resolveUserPrimaryEmailLower(pool, userId)
    if (!userEmail) {
      res.status(403).json({ ok: false, message: 'NO_EMAIL' })
      return
    }

    let appt
    try {
      appt = await fetchAppointmentByRoom(pool, roomId)
    } catch (err) {
      console.error('[rooms/draw-logs POST]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (!appt) {
      res.status(404).json({ ok: false, message: 'Room not found' })
      return
    }
    if (appt.status === 'cancelled') {
      res.status(410).json({ ok: false, message: 'This session has been cancelled' })
      return
    }

    let allowed
    try {
      allowed = await userMayAccessRoom(pool, userId, userEmail, appt)
    } catch (err) {
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (!allowed) {
      res.status(403).json({ ok: false, message: 'Forbidden' })
      return
    }

    if (appt.host_id !== userId) {
      res.status(403).json({ ok: false, message: 'Only the host can open cases' })
      return
    }

    try {
      const ins = await pool.query(
        `INSERT INTO room_case_draw_logs
          (appointment_id, clerk_user_id, game_id, game_title, tier_rank)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [appt.id, userId, Number.isFinite(gameId) ? gameId : null, gameTitle, Math.round(tierRank)],
      )
      const row = ins.rows[0]
      const displayId = await displayIdForClerkUser(pool, userId)
      res.status(201).json({
        ok: true,
        log: {
          id: String(row.id),
          clerkUserId: userId,
          displayId,
          gameId: Number.isFinite(gameId) ? gameId : null,
          gameTitle,
          tierRank: Math.round(tierRank),
          createdAt: row.created_at,
        },
      })
    } catch (err) {
      if (err && String(err.code) === '42P01') {
        res.status(503).json({
          ok: false,
          message: 'room_case_draw_logs table missing; restart the server to auto-create it',
        })
        return
      }
      console.error('[rooms/draw-logs POST] insert', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.delete('/api/rooms/:roomId/draw-logs', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const userId = await clerkUserIdFromRequest(req)
    if (!userId) {
      res.status(401).json({ ok: false, message: 'Unauthorized' })
      return
    }

    const roomId = decodeURIComponent(String(req.params.roomId ?? '')).trim()
    if (!roomId || !roomId.toLowerCase().startsWith('rm_')) {
      res.status(400).json({ ok: false, message: 'Invalid room id (expected rm_…)' })
      return
    }

    const userEmail = await resolveUserPrimaryEmailLower(pool, userId)
    if (!userEmail) {
      res.status(403).json({ ok: false, message: 'NO_EMAIL' })
      return
    }

    let appt
    try {
      appt = await fetchAppointmentByRoom(pool, roomId)
    } catch (err) {
      console.error('[rooms/draw-logs DELETE]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (!appt) {
      res.status(404).json({ ok: false, message: 'Room not found' })
      return
    }
    if (appt.status === 'cancelled') {
      res.status(410).json({ ok: false, message: 'This session has been cancelled' })
      return
    }

    let allowed
    try {
      allowed = await userMayAccessRoom(pool, userId, userEmail, appt)
    } catch (err) {
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (!allowed) {
      res.status(403).json({ ok: false, message: 'Forbidden' })
      return
    }

    try {
      const del = await pool.query(
        `DELETE FROM room_case_draw_logs WHERE appointment_id = $1`,
        [appt.id],
      )
      res.json({ ok: true, deletedCount: del.rowCount ?? 0 })
    } catch (err) {
      if (err && String(err.code) === '42P01') {
        res.json({ ok: true, deletedCount: 0 })
        return
      }
      console.error('[rooms/draw-logs DELETE] query', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
