import { ROOM_VETO_LIMIT } from './roomGameSession.js'
import { dispatchRoomEvent, EventType } from './roomFsm/roomService.js'
import { resolveAuthorizedRoomContext, sendRoomContextError } from './roomContext.js'

/**
 * POST /api/rooms/:roomId/votes  body: { vote: 'approve' | 'reject', gameTitle?: string }
 * 投票列表见 GET /api/rooms/:roomId/live
 */
export function registerRoomGameVoteRoutes(app, pool) {
  app.post('/api/rooms/:roomId/votes', async (req, res) => {
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

    const vote = String(req.body?.vote ?? '').trim().toLowerCase()
    if (vote !== 'approve' && vote !== 'reject') {
      res.status(400).json({ ok: false, message: 'vote must be approve or reject' })
      return
    }

    const gameTitle =
      typeof req.body?.gameTitle === 'string' ? req.body.gameTitle.trim() : ''

    const userEmail = await resolveUserPrimaryEmailLower(pool, userId)
    if (!userEmail) {
      res.status(403).json({ ok: false, message: 'NO_EMAIL' })
      return
    }

    let appt
    try {
      appt = await fetchAppointmentByRoom(pool, roomId)
    } catch (err) {
      console.error('[rooms/votes POST]', err)
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
      console.error('[rooms/votes POST] access', err)
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

    const authCtx = await resolveAuthorizedRoomContext(pool, req, roomId)
    if (!authCtx.ok) {
      sendRoomContextError(res, authCtx)
      return
    }

    try {
      const result = await dispatchRoomEvent(
        pool,
        {
          appt: authCtx.appt,
          userId: authCtx.userId,
          isHost: authCtx.appt.host_id === authCtx.userId,
        },
        EventType.VETO_USED,
        { vote, gameTitle },
      )

      if (!result.ok) {
        const status =
          result.code === 'RATE_LIMITED'
            ? 429
            : result.code === 'VETO_LIMIT_REACHED'
            ? 403
            : result.code === 'INVALID_TRANSITION'
              ? 409
              : 400
        res.status(status).json(result)
        return
      }

      const { countUserVetoes } = await import('./roomGameSession.js')
      const vetoUsed = await countUserVetoes(pool, authCtx.appt.id, authCtx.userId)

      res.json({
        ok: true,
        vote,
        gameTitle: gameTitle || null,
        roomPhase: result.phase,
        vetoLimit: ROOM_VETO_LIMIT,
        vetoUsed,
        vetoRemaining: Math.max(0, ROOM_VETO_LIMIT - vetoUsed),
        vetoOutcome: result.vetoOutcome ?? 'pending',
      })
    } catch (err) {
      if (err && String(err.code) === '42P01') {
        res.status(503).json({
          ok: false,
          message: 'room_game_votes table missing; restart the server to auto-create it',
        })
        return
      }
      console.error('[rooms/votes POST]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
