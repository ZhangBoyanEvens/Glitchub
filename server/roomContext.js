import { clerkUserIdFromRequest } from './clerkAuth.js'
import { resolveUserPrimaryEmailLower } from './clerkUserEmail.js'
import { cached, TTL } from './roomCache.js'
import { fetchAppointmentByRoom, userMayAccessRoom } from './roomAccess.js'

/**
 * @param {import('pg').Pool} pool
 * @param {string} roomId
 */
function appointmentCacheKey(roomId) {
  return `appt:${roomId.trim().toLowerCase()}`
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} roomId
 */
export function getCachedAppointment(pool, roomId) {
  const key = appointmentCacheKey(roomId)
  return cached(
    key,
    () => fetchAppointmentByRoom(pool, roomId),
    TTL.appointmentMs,
  )
}


/**
 * @param {import('pg').Pool} pool
 * @param {{ id: string, host_id: string }} appt
 * @param {string} userId
 * @param {string} userEmailLower
 */
async function getCachedAccess(pool, appt, userId, userEmailLower) {
  const key = `access:${appt.id}:${userId}:${userEmailLower}`
  return cached(
    key,
    () => userMayAccessRoom(pool, userId, userEmailLower, appt),
    TTL.accessMs,
  )
}

/**
 * 房间内 API 统一鉴权：一次 JWT + 缓存邮箱/预约/权限。
 *
 * @param {import('pg').Pool} pool
 * @param {import('express').Request} req
 * @param {string} roomId
 */
export async function resolveAuthorizedRoomContext(pool, req, roomId) {
  const userId = await clerkUserIdFromRequest(req)
  if (!userId) {
    return { ok: false, status: 401, message: 'Unauthorized' }
  }

  const userEmail = await resolveUserPrimaryEmailLower(pool, userId)
  if (!userEmail) {
    return {
      ok: false,
      status: 403,
      code: 'NO_EMAIL',
      message:
        'Your account has no primary email in Clerk (and no synced row in Neon). Add a verified email to join.',
    }
  }

  const appt = await getCachedAppointment(pool, roomId)
  if (!appt) {
    return { ok: false, status: 404, message: 'Room not found' }
  }
  if (appt.status === 'cancelled') {
    return { ok: false, status: 410, message: 'This session has been cancelled' }
  }

  const allowed = await getCachedAccess(pool, appt, userId, userEmail)
  if (!allowed) {
    return { ok: false, status: 403, message: 'Forbidden' }
  }

  return { ok: true, userId, userEmail, appt }
}

/**
 * @param {import('express').Response} res
 * @param {{ ok: false, status: number, message: string, code?: string }} err
 */
export function sendRoomContextError(res, err) {
  const body = { ok: false, message: err.message }
  if (err.code) body.code = err.code
  res.status(err.status).json(body)
}
