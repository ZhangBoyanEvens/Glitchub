import { randomUUID } from 'node:crypto'
import { clerkUserIdFromRequest } from '../clerkAuth.js'
import {
  buildGameSessionResponse,
  fetchAppointmentByRoom,
} from '../roomAccess.js'
import {
  resolveAuthorizedRoomContext,
  sendRoomContextError,
} from '../roomContext.js'
import { EventType } from './eventTypes.js'
import { processRoomEvent, syncFsmOnRead } from './eventProcessor.js'
import { loadFsmContext } from './roomFsmPersistence.js'
import { RoomPhase, resolvePhaseFromAppointment } from './roomPhases.js'
import { spinRowToWsPayload } from './spinEngine.js'

/**
 * @param {import('pg').Pool} pool
 * @param {{ appt: import('pg').QueryResultRow, userId: string }} auth
 */
export async function buildFsmLiveExtras(pool, auth) {
  const ctx = await syncFsmOnRead(pool, auth.appt)
  if (!ctx) {
    return {
      roomPhase: RoomPhase.LOBBY,
      roomRound: 0,
      playerReady: {},
      activeSpin: null,
      finalGameId: null,
      finalGameTitle: null,
    }
  }

  const ready = Object.fromEntries(ctx.readyByUser.entries())
  const activeSpin = ctx.activeSpin ? spinRowToWsPayload(ctx.activeSpin) : null

  return {
    roomPhase: ctx.phase,
    roomRound: ctx.round,
    playerReady: ready,
    activeSpin,
    finalGameId: ctx.appt.final_game_id ?? null,
    finalGameTitle: ctx.appt.final_game_title ?? null,
  }
}

/**
 * @param {import('express').Express} app
 * @param {import('pg').Pool | null} pool
 */
export function registerRoomFsmRoutes(app, pool) {
  app.post('/api/rooms/:roomId/events', async (req, res) => {
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

    const type = String(req.body?.type ?? '').trim()
    if (!type) {
      res.status(400).json({ ok: false, message: 'type is required' })
      return
    }

    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {}

    try {
      const result = await processRoomEvent(
        pool,
        {
          appt: ctx.appt,
          userId: ctx.userId,
          isHost: ctx.appt.host_id === ctx.userId,
        },
        {
          type,
          payload,
          eventId: typeof req.body?.eventId === 'string' ? req.body.eventId : randomUUID(),
        },
      )

      if (!result.ok) {
        const status =
          result.code === 'RATE_LIMITED'
            ? 429
            : result.code === 'FORBIDDEN'
            ? 403
            : result.code === 'INVALID_TRANSITION' || result.code === 'BAD_REQUEST'
              ? 409
              : result.code === 'GAME_START_TOO_EARLY' || result.code === 'ROOM_END_BEFORE_SCHEDULED'
                ? 403
                : 400
        res.status(status).json(result)
        return
      }

      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[rooms/events POST]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}

/**
 * 供遗留路由调用的统一入口。
 *
 * @param {import('pg').Pool} pool
 * @param {{ appt: import('pg').QueryResultRow, userId: string, isHost: boolean }} auth
 * @param {string} type
 * @param {Record<string, unknown>} [payload]
 */
export async function dispatchRoomEvent(pool, auth, type, payload = {}) {
  return processRoomEvent(pool, auth, { type, payload })
}

export { EventType, processRoomEvent, syncFsmOnRead, resolvePhaseFromAppointment, RoomPhase }
