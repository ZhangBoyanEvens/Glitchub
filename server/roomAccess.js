import { newRoomId } from './roomIds.js'

export const ROOM_KIND_INSTANT = 'instant'

const INSTANT_APPT_SELECT = `SELECT id, host_id, room_id, status, scheduled_at, join_code
     FROM appointments
     WHERE room_kind = $1
       AND join_code = $2
       AND status <> 'cancelled'`

/**
 * @param {{ room_kind?: string | null }} appt
 */
export function isInstantAppointment(appt) {
  return appt?.room_kind === ROOM_KIND_INSTANT
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} roomId
 */
export async function fetchAppointmentByRoom(pool, roomId) {
  const q = await pool.query(
    `SELECT id, host_id, room_id, status, scheduled_at, room_kind, join_code,
            host_invitation_id, game_started_at, game_started_by,
            room_phase, room_round, active_spin_id, final_game_id, final_game_title
     FROM appointments
     WHERE lower(trim(room_id)) = lower(trim($1))`,
    [roomId],
  )
  return q.rows[0] ?? null
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} userId
 * @param {string} userEmailLower
 * @param {{ id: string, host_id: string }} appt
 */
export async function userMayAccessRoom(pool, userId, userEmailLower, appt) {
  if (appt.host_id === userId) return true
  const pq = await pool.query(
    `SELECT status FROM appointment_participants
     WHERE appointment_id = $1 AND lower(trim(email)) = lower(trim($2))`,
    [appt.id, userEmailLower],
  )
  if (!pq.rows.length) return false
  return pq.rows[0].status !== 'declined'
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} appointmentId
 * @param {string} emailLower
 */
export async function ensureInstantParticipant(db, appointmentId, emailLower) {
  const em = emailLower.trim().toLowerCase()
  const upd = await db.query(
    `UPDATE appointment_participants
     SET status = 'accepted', updated_at = now()
     WHERE appointment_id = $1
       AND lower(trim(email)) = $2
       AND status <> 'accepted'`,
    [appointmentId, em],
  )
  if (upd.rowCount > 0) return
  await db.query(
    `INSERT INTO appointment_participants (appointment_id, email, status)
     VALUES ($1, $2, 'accepted')`,
    [appointmentId, em],
  )
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeInstantJoinCode(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 4 || digits.length > 6) return null
  return digits
}

/** 预约房须到 scheduled_at 之后；现场房随时可结束 */
export function hostMayEndRoom(appt) {
  if (isInstantAppointment(appt)) return true
  const scheduledMs = new Date(appt.scheduled_at).getTime()
  return Number.isFinite(scheduledMs) && Date.now() >= scheduledMs
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} userId
 * @param {string} joinCode
 */
export async function findOrCreateInstantAppointment(client, userId, joinCode) {
  const locked = await client.query(`${INSTANT_APPT_SELECT} FOR UPDATE`, [
    ROOM_KIND_INSTANT,
    joinCode,
  ])
  if (locked.rows.length) return locked.rows[0]

  try {
    const ins = await client.query(
      `INSERT INTO appointments (
         host_id, scheduled_at, room_id, status, room_kind, join_code
       )
       VALUES ($1, now(), $2, 'confirmed', $3, $4)
       RETURNING id, host_id, room_id, status, scheduled_at, join_code`,
      [userId, newRoomId(), ROOM_KIND_INSTANT, joinCode],
    )
    return ins.rows[0]
  } catch (err) {
    if (!err || String(err.code) !== '23505') throw err
    const retry = await client.query(`${INSTANT_APPT_SELECT} FOR UPDATE`, [
      ROOM_KIND_INSTANT,
      joinCode,
    ])
    if (!retry.rows.length) throw err
    return retry.rows[0]
  }
}

/**
 * @param {{ id: string, host_id: string, room_id: string, join_code?: string | null, scheduled_at: Date | string }} appt
 * @param {string} userId
 */
export function instantJoinResponse(appt, userId) {
  return {
    ok: true,
    role: appt.host_id === userId ? 'host' : 'invitee',
    roomKind: ROOM_KIND_INSTANT,
    joinCode: appt.join_code,
    appointmentId: appt.id,
    roomId: appt.room_id,
    scheduledAt: appt.scheduled_at,
  }
}

/**
 * @param {{ host_id: string, game_started_at?: Date | string | null, game_started_by?: string | null, scheduled_at: Date | string, room_kind?: string | null, join_code?: string | null }} appt
 * @param {string} userId
 * @param {{ started: boolean, vetoUsed: number, vetoLimit: number }} opts
 */
export function buildGameSessionResponse(
  appt,
  userId,
  { started, vetoUsed, vetoLimit, roomPhase, roomRound, playerReady, activeSpin, finalGame },
) {
  const instant = isInstantAppointment(appt)
  const isHost = appt.host_id === userId
  return {
    ok: true,
    started,
    startedAt: appt.game_started_at ?? null,
    startedByClerkUserId: appt.game_started_by ?? null,
    isHost,
    roomKind: instant ? ROOM_KIND_INSTANT : 'scheduled',
    joinCode: instant ? appt.join_code ?? null : null,
    scheduledAt: appt.scheduled_at ?? null,
    canEndRoom: isHost && hostMayEndRoom(appt),
    vetoLimit,
    vetoUsed,
    vetoRemaining: Math.max(0, vetoLimit - vetoUsed),
    roomPhase: roomPhase ?? 'LOBBY',
    roomRound: roomRound ?? 0,
    playerReady: playerReady ?? {},
    selfReady: Boolean(playerReady?.[userId]),
    activeSpin: activeSpin ?? null,
    finalGameId: finalGame?.id ?? null,
    finalGameTitle: finalGame?.title ?? null,
  }
}
