/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} appointmentId
 * @param {number} ttlSeconds
 */
export async function fetchOnlineUserIds(db, appointmentId, ttlSeconds) {
  const q = await db.query(
    `SELECT clerk_user_id FROM room_presence
     WHERE appointment_id = $1
       AND last_seen_at >= now() - ($2::numeric * interval '1 second')`,
    [appointmentId, ttlSeconds],
  )
  return q.rows.map((r) => r.clerk_user_id).filter(Boolean)
}
