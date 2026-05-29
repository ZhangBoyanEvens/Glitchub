/**
 * Lightweight user reputation stats (visibility only, no permission gating).
 */

export async function ensureReputationSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_reputation_stats (
      clerk_user_id TEXT PRIMARY KEY,
      accepted_invites INTEGER NOT NULL DEFAULT 0,
      joined_sessions INTEGER NOT NULL DEFAULT 0,
      late_joins INTEGER NOT NULL DEFAULT 0,
      no_shows INTEGER NOT NULL DEFAULT 0,
      completed_sessions INTEGER NOT NULL DEFAULT 0,
      attendance_rate REAL NOT NULL DEFAULT 1,
      late_join_rate REAL NOT NULL DEFAULT 0,
      no_show_rate REAL NOT NULL DEFAULT 0,
      room_completion_rate REAL NOT NULL DEFAULT 1,
      reliability_score INTEGER NOT NULL DEFAULT 100,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reputation_session_joins (
      appointment_id UUID NOT NULL,
      clerk_user_id TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (appointment_id, clerk_user_id)
    )
  `)
}

/**
 * @param {import('pg').QueryResultRow} row
 */
export function recomputeReputationRates(row) {
  const accepted = Number(row.accepted_invites) || 0
  const joined = Number(row.joined_sessions) || 0
  const late = Number(row.late_joins) || 0
  const noShow = Number(row.no_shows) || 0
  const completed = Number(row.completed_sessions) || 0

  const attendance_rate = accepted > 0 ? joined / accepted : 1
  const late_join_rate = joined > 0 ? late / joined : 0
  const no_show_rate = accepted > 0 ? noShow / accepted : 0
  const room_completion_rate = joined > 0 ? completed / joined : 1

  let reliability_score = 100
  reliability_score -= Math.round(late_join_rate * 30)
  reliability_score -= Math.round(no_show_rate * 40)
  reliability_score -= Math.round((1 - room_completion_rate) * 20)
  reliability_score = Math.max(0, Math.min(100, reliability_score))

  return {
    attendance_rate,
    late_join_rate,
    no_show_rate,
    room_completion_rate,
    reliability_score,
  }
}

/**
 * @param {number} score
 */
export function reliabilityBadgeFromScore(score) {
  if (score >= 90) return 'Reliable'
  if (score >= 70) return 'Average'
  return 'Risky'
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} clerkUserId
 */
async function upsertAndRecompute(pool, clerkUserId) {
  await pool.query(
    `INSERT INTO user_reputation_stats (clerk_user_id) VALUES ($1)
     ON CONFLICT (clerk_user_id) DO NOTHING`,
    [clerkUserId],
  )
  const q = await pool.query(`SELECT * FROM user_reputation_stats WHERE clerk_user_id = $1`, [
    clerkUserId,
  ])
  const row = q.rows[0]
  if (!row) return null
  const rates = recomputeReputationRates(row)
  await pool.query(
    `UPDATE user_reputation_stats
     SET attendance_rate = $2,
         late_join_rate = $3,
         no_show_rate = $4,
         room_completion_rate = $5,
         reliability_score = $6,
         updated_at = now()
     WHERE clerk_user_id = $1`,
    [
      clerkUserId,
      rates.attendance_rate,
      rates.late_join_rate,
      rates.no_show_rate,
      rates.room_completion_rate,
      rates.reliability_score,
    ],
  )
  return { ...row, ...rates }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string[]} userIds
 */
export async function getReputationForUsers(pool, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return {}

  const q = await pool.query(
    `SELECT * FROM user_reputation_stats WHERE clerk_user_id = ANY($1::text[])`,
    [ids],
  )
  /** @type {Record<string, object>} */
  const out = {}
  for (const row of q.rows) {
    const badge = reliabilityBadgeFromScore(row.reliability_score)
    out[row.clerk_user_id] = {
      attendanceRate: row.attendance_rate,
      lateJoinRate: row.late_join_rate,
      noShowRate: row.no_show_rate,
      roomCompletionRate: row.room_completion_rate,
      reliabilityScore: row.reliability_score,
      badge,
    }
  }
  for (const id of ids) {
    if (!out[id]) {
      out[id] = {
        attendanceRate: 1,
        lateJoinRate: 0,
        noShowRate: 0,
        roomCompletionRate: 1,
        reliabilityScore: 100,
        badge: 'Reliable',
      }
    }
  }
  return out
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} clerkUserId
 */
export async function recordInviteAccepted(pool, clerkUserId) {
  if (!clerkUserId) return
  await pool.query(
    `INSERT INTO user_reputation_stats (clerk_user_id, accepted_invites)
     VALUES ($1, 1)
     ON CONFLICT (clerk_user_id)
     DO UPDATE SET accepted_invites = user_reputation_stats.accepted_invites + 1,
                   updated_at = now()`,
    [clerkUserId],
  )
  await upsertAndRecompute(pool, clerkUserId)
}

const LATE_JOIN_MS = 5 * 60 * 1000

/**
 * Idempotent: first presence in a session.
 *
 * @param {import('pg').Pool} pool
 * @param {import('pg').QueryResultRow} appt
 * @param {string} clerkUserId
 */
export async function recordSessionJoined(pool, appt, clerkUserId) {
  if (!clerkUserId || !appt?.id) return

  const ins = await pool.query(
    `INSERT INTO reputation_session_joins (appointment_id, clerk_user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING appointment_id`,
    [appt.id, clerkUserId],
  )
  if (!ins.rows.length) return

  const scheduledMs = appt.scheduled_at ? new Date(appt.scheduled_at).getTime() : NaN
  const isLate =
    Number.isFinite(scheduledMs) && Date.now() > scheduledMs + LATE_JOIN_MS

  await pool.query(
    `INSERT INTO user_reputation_stats (clerk_user_id, joined_sessions, late_joins, accepted_invites)
     VALUES ($1, 1, $2, 1)
     ON CONFLICT (clerk_user_id)
     DO UPDATE SET
       joined_sessions = user_reputation_stats.joined_sessions + 1,
       late_joins = user_reputation_stats.late_joins + $2,
       accepted_invites = GREATEST(user_reputation_stats.accepted_invites, user_reputation_stats.joined_sessions + 1),
       updated_at = now()`,
    [clerkUserId, isLate ? 1 : 0],
  )
  await upsertAndRecompute(pool, clerkUserId)
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} clerkUserId
 */
export async function recordSessionCompleted(pool, clerkUserId) {
  if (!clerkUserId) return
  await pool.query(
    `INSERT INTO user_reputation_stats (clerk_user_id, completed_sessions)
     VALUES ($1, 1)
     ON CONFLICT (clerk_user_id)
     DO UPDATE SET completed_sessions = user_reputation_stats.completed_sessions + 1,
                   updated_at = now()`,
    [clerkUserId],
  )
  await upsertAndRecompute(pool, clerkUserId)
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} clerkUserId
 */
export async function recordNoShow(pool, clerkUserId) {
  if (!clerkUserId) return
  await pool.query(
    `INSERT INTO user_reputation_stats (clerk_user_id, no_shows, accepted_invites)
     VALUES ($1, 1, 1)
     ON CONFLICT (clerk_user_id)
     DO UPDATE SET no_shows = user_reputation_stats.no_shows + 1,
                   accepted_invites = GREATEST(user_reputation_stats.accepted_invites, user_reputation_stats.no_shows + 1),
                   updated_at = now()`,
    [clerkUserId],
  )
  await upsertAndRecompute(pool, clerkUserId)
}

/**
 * @param {import('pg').Pool} pool
 * @param {import('pg').QueryResultRow} appt
 */
export async function finalizeSessionReputation(pool, appt) {
  if (!appt?.id) return

  const joined = await pool.query(
    `SELECT clerk_user_id FROM reputation_session_joins WHERE appointment_id = $1`,
    [appt.id],
  )
  const joinedIds = new Set(joined.rows.map((r) => r.clerk_user_id))

  for (const uid of joinedIds) {
    await recordSessionCompleted(pool, uid)
  }

  const participants = await pool.query(
    `SELECT lower(trim(email)) AS email FROM appointment_participants
     WHERE appointment_id = $1 AND status = 'accepted'`,
    [appt.id],
  )
  if (!participants.rows.length) return

  const emails = participants.rows.map((r) => r.email).filter(Boolean)
  const sync = await pool.query(
    `SELECT clerk_user_id, lower(trim(primary_email)) AS email
     FROM clerk_synced_users
     WHERE lower(trim(primary_email)) = ANY($1::text[])`,
    [emails],
  )
  for (const row of sync.rows) {
    if (row.clerk_user_id && !joinedIds.has(row.clerk_user_id)) {
      await recordNoShow(pool, row.clerk_user_id)
    }
  }
}
