import { randomUUID } from 'node:crypto'
import { invalidatePrefix } from '../roomCache.js'
import { resolvePhaseFromAppointment } from './roomPhases.js'
import { RoomPhase } from './roomPhases.js'

/**
 * Claim event_id before handler side effects. Returns false if already processed.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {object} event
 * @param {string} appointmentId
 */
export async function claimEventId(db, event, appointmentId) {
  const result = await db.query(
    `INSERT INTO room_events (event_id, appointment_id, room_id, event_type, clerk_user_id, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, to_timestamp($7 / 1000.0))
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [
      event.eventId,
      appointmentId,
      event.roomId,
      event.type,
      event.userId,
      JSON.stringify(event.payload ?? {}),
      event.timestamp,
    ],
  ).catch((err) => {
    if (err && String(err.code) === '42P01') return { rowCount: 0, rows: [] }
    throw err
  })
  return result.rowCount > 0
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 */
export async function loadFsmContext(pool, appointmentId) {
  const q = await pool.query(
    `SELECT id, host_id, room_id, status, scheduled_at, room_kind, join_code,
            game_started_at, game_started_by, room_phase, room_round,
            active_spin_id, final_game_id, final_game_title
     FROM appointments WHERE id = $1`,
    [appointmentId],
  )
  const appt = q.rows[0]
  if (!appt) return null

  const readyQ = await pool.query(
    `SELECT clerk_user_id, is_ready
     FROM room_player_ready WHERE appointment_id = $1`,
    [appointmentId],
  ).catch((err) => {
    if (err && String(err.code) === '42P01') return { rows: [] }
    throw err
  })

  const spinQ = await pool.query(
    `SELECT spin_id, room_id, seed, result_game_id, result_game_title, tier_rank,
            spin_duration_ms, server_timestamp_ms, reveal_timestamp_ms, round_number,
            invalidated_at
     FROM room_spins
     WHERE appointment_id = $1 AND invalidated_at IS NULL
     ORDER BY server_timestamp_ms DESC
     LIMIT 1`,
    [appointmentId],
  ).catch((err) => {
    if (err && String(err.code) === '42P01') return { rows: [] }
    throw err
  })

  const phase = resolvePhaseFromAppointment(appt)
  return {
    appt,
    phase,
    round: Number(appt.room_round ?? 0),
    readyByUser: new Map(readyQ.rows.map((r) => [r.clerk_user_id, Boolean(r.is_ready)])),
    activeSpin: spinQ.rows[0] ?? null,
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 * @param {string} roomId
 * @param {string} phase
 * @param {Partial<{ round: number, activeSpinId: string | null, finalGameId: number | null, finalGameTitle: string | null }>} extra
 */
export async function persistPhase(pool, appointmentId, roomId, phase, extra = {}) {
  const sets = ['room_phase = $2', 'updated_at = now()']
  const params = [appointmentId, phase]
  let i = 3

  if (extra.round != null) {
    sets.push(`room_round = $${i}`)
    params.push(extra.round)
    i++
  }
  if (extra.activeSpinId !== undefined) {
    sets.push(`active_spin_id = $${i}`)
    params.push(extra.activeSpinId)
    i++
  }
  if (extra.finalGameId !== undefined) {
    sets.push(`final_game_id = $${i}`)
    params.push(extra.finalGameId)
    i++
  }
  if (extra.finalGameTitle !== undefined) {
    sets.push(`final_game_title = $${i}`)
    params.push(extra.finalGameTitle)
    i++
  }

  if (phase === RoomPhase.WISH_COLLECTION) {
    sets.push(`game_started_at = COALESCE(game_started_at, now())`)
  }

  await pool.query(
    `UPDATE appointments SET ${sets.join(', ')} WHERE id = $1`,
    params,
  )
  invalidatePrefix(`appt:${roomId.trim().toLowerCase()}`)
}

/**
 * @param {import('pg').Pool} pool
 * @param {object} event
 */
export async function appendEventLog(pool, event) {
  await pool.query(
    `INSERT INTO room_events (event_id, appointment_id, room_id, event_type, clerk_user_id, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, to_timestamp($7 / 1000.0))`,
    [
      event.eventId,
      event.appointmentId,
      event.roomId,
      event.type,
      event.userId,
      JSON.stringify(event.payload ?? {}),
      event.timestamp,
    ],
  ).catch((err) => {
    if (err && String(err.code) === '42P01') return
    if (err && String(err.code) === '23505') return
    throw err
  })
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 * @param {string} userId
 * @param {boolean} ready
 */
export async function setPlayerReady(pool, appointmentId, userId, ready) {
  await pool.query(
    `INSERT INTO room_player_ready (appointment_id, clerk_user_id, is_ready, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (appointment_id, clerk_user_id)
     DO UPDATE SET is_ready = EXCLUDED.is_ready, updated_at = now()`,
    [appointmentId, userId, ready],
  )
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 * @param {string[]} onlineUserIds
 * @param {Map<string, boolean>} readyByUser
 */
export function allOnlinePlayersReady(onlineUserIds, readyByUser) {
  if (!onlineUserIds.length) return false
  return onlineUserIds.every((id) => readyByUser.get(id) === true)
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 * @param {string} hostUserId
 */
export async function markGameStarted(pool, appointmentId, hostUserId) {
  await pool.query(
    `UPDATE appointments
     SET game_started_at = COALESCE(game_started_at, now()),
         game_started_by = COALESCE(game_started_by, $2)
     WHERE id = $1`,
    [appointmentId, hostUserId],
  )
}

export function newEventId() {
  return randomUUID()
}
