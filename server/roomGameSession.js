import {

  buildGameSessionResponse,

  fetchAppointmentByRoom,

} from './roomAccess.js'

import {

  resolveAuthorizedRoomContext,

  sendRoomContextError,

} from './roomContext.js'

import { dispatchRoomEvent, EventType, buildFsmLiveExtras } from './roomFsm/roomService.js'

import { resolvePhaseFromAppointment, RoomPhase } from './roomFsm/roomPhases.js'



export const ROOM_VETO_LIMIT = 2



/**

 * @param {import('pg').Pool} pool

 * @param {string} appointmentId

 * @param {string} userId

 */

export async function countUserVetoes(pool, appointmentId, userId) {
  const q = await pool.query(
    `SELECT COALESCE(reject_count, 0)::int AS n
     FROM room_game_vetoes
     WHERE appointment_id = $1 AND clerk_user_id = $2`,
    [appointmentId, userId],
  )
  return q.rows[0]?.n ?? 0
}



/**

 * @param {import('pg').Pool} pool

 * @param {string} appointmentId

 * @param {string} userId

 */

export async function getUserCurrentVote(pool, appointmentId, userId) {

  const q = await pool.query(

    `SELECT vote FROM room_game_votes

     WHERE appointment_id = $1 AND clerk_user_id = $2`,

    [appointmentId, userId],

  )

  return q.rows[0]?.vote ?? null

}



/**

 * @param {import('pg').Pool} pool

 * @param {import('pg').QueryResultRow} appt

 * @param {string} userId

 */

async function sessionPayload(pool, appt, userId) {

  const phase = resolvePhaseFromAppointment(appt)

  const started = phase !== RoomPhase.LOBBY

  let vetoUsed = 0

  if (started) {

    vetoUsed = await countUserVetoes(pool, appt.id, userId).catch((err) => {

      if (err && String(err.code) === '42P01') return 0

      throw err

    })

  }

  const fsm = await buildFsmLiveExtras(pool, { appt, userId })

  return buildGameSessionResponse(appt, userId, {

    started,

    vetoUsed,

    vetoLimit: ROOM_VETO_LIMIT,

    roomPhase: fsm.roomPhase,

    roomRound: fsm.roomRound,

    playerReady: fsm.playerReady,

    activeSpin: fsm.activeSpin,

    finalGame: fsm.finalGameId

      ? { id: fsm.finalGameId, title: fsm.finalGameTitle }

      : null,

  })

}



/**

 * POST /api/rooms/:roomId/game-session/start  (host → GAME_START_REQUESTED)
 * POST /api/rooms/:roomId/game-session/ready  body: { ready: boolean }
 * POST /api/rooms/:roomId/game-session/force-lock
 * 读模型见 GET /api/rooms/:roomId/live
 */
export function registerRoomGameSessionRoutes(app, pool) {
  app.post('/api/rooms/:roomId/game-session/start', async (req, res) => {

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

        EventType.GAME_START_REQUESTED,

      )

      if (!result.ok) {

        const status =

          result.code === 'FORBIDDEN' ||
          result.code === 'GAME_START_TOO_EARLY' ||
          result.code === 'NOT_ALL_READY'
            ? 403
            : 409

        res.status(status).json(result)

        return

      }

      const fresh = await fetchAppointmentByRoom(pool, roomId)

      res.json(await sessionPayload(pool, fresh, ctx.userId))

    } catch (err) {

      console.error('[rooms/game-session/start]', err)

      res.status(500).json({

        ok: false,

        message: err instanceof Error ? err.message : String(err),

      })

    }

  })



  app.post('/api/rooms/:roomId/game-session/ready', async (req, res) => {

    if (!pool) {

      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })

      return

    }



    const roomId = decodeURIComponent(String(req.params.roomId ?? '')).trim()

    const ctx = await resolveAuthorizedRoomContext(pool, req, roomId)

    if (!ctx.ok) {

      sendRoomContextError(res, ctx)

      return

    }



    const ready = Boolean(req.body?.ready)

    try {

      const result = await dispatchRoomEvent(

        pool,

        {

          appt: ctx.appt,

          userId: ctx.userId,

          isHost: ctx.appt.host_id === ctx.userId,

        },

        EventType.PLAYER_READY_TOGGLED,

        { ready },

      )

      if (!result.ok) {

        res.status(result.code === 'INVALID_TRANSITION' ? 409 : 400).json(result)

        return

      }

      const fresh = await fetchAppointmentByRoom(pool, roomId)

      res.json(await sessionPayload(pool, fresh, ctx.userId))

    } catch (err) {

      console.error('[rooms/game-session/ready]', err)

      res.status(500).json({ ok: false, message: String(err) })

    }

  })



  app.post('/api/rooms/:roomId/game-session/force-lock', async (req, res) => {

    if (!pool) {

      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })

      return

    }



    const roomId = decodeURIComponent(String(req.params.roomId ?? '')).trim()

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

        EventType.GAME_START_REQUESTED,

        { forceReadyLock: true },

      )

      if (!result.ok) {

        res.status(result.code === 'FORBIDDEN' ? 403 : 409).json(result)

        return

      }

      const fresh = await fetchAppointmentByRoom(pool, roomId)

      res.json(await sessionPayload(pool, fresh, ctx.userId))

    } catch (err) {

      console.error('[rooms/game-session/force-lock]', err)

      res.status(500).json({ ok: false, message: String(err) })

    }

  })

}

