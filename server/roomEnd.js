import { clerkUserIdFromRequest } from './clerkAuth.js'

import { fetchAppointmentByRoom } from './roomAccess.js'

import { deleteCancelledAppointmentRecord } from './roomExpire.js'

import { dispatchRoomEvent, EventType } from './roomFsm/roomService.js'



/**

 * POST /api/rooms/:roomId/end  — ROOM_CLOSED（FSM）

 */

export function registerRoomEndRoutes(app, pool) {

  app.post('/api/rooms/:roomId/end', async (req, res) => {

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



    let appt

    try {

      appt = await fetchAppointmentByRoom(pool, roomId)

    } catch (err) {

      console.error('[rooms/end]', err)

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

      try {

        await deleteCancelledAppointmentRecord(pool, appt)

      } catch (err) {

        console.error('[rooms/end] purge cancelled', err)

      }

      res.json({

        ok: true,

        roomId: appt.room_id,

        status: 'cancelled',

        alreadyEnded: true,

        deleted: true,

      })

      return

    }



    try {

      const result = await dispatchRoomEvent(

        pool,

        { appt, userId, isHost: appt.host_id === userId },

        EventType.ROOM_CLOSED,

      )



      if (!result.ok) {

        const status = result.code === 'ROOM_END_BEFORE_SCHEDULED' ? 403 : result.code === 'FORBIDDEN' ? 403 : 400

        res.status(status).json(result)

        return

      }



      res.json({ ok: true, roomId: appt.room_id, status: 'cancelled', deleted: true })

    } catch (err) {

      console.error('[rooms/end]', err)

      res.status(500).json({

        ok: false,

        message: err instanceof Error ? err.message : String(err),

      })

    }

  })

}

