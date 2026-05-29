/** 超过该秒数未心跳视为离线 */
export const PRESENCE_TTL_SECONDS = 45

/**
 * @param {import('pg').QueryResultRow} row
 */
export function displayIdFromSyncRow(row) {
  const u = row.username?.trim()
  if (u) return u
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  if (name) return name
  const em = row.primary_email?.trim()
  if (em) return em.split('@')[0] || em
  return row.clerk_user_id?.slice(0, 10) ?? 'user'
}

/**
 * 仅从 Neon 组装成员列表（热路径禁止 Clerk HTTP）。
 *
 * @param {import('pg').Pool} pool
 * @param {{ id: string, host_id: string }} appt
 */
export async function fetchRoomMembersFast(pool, appt) {
  const hostId = appt.host_id

  const [hostQ, participantQ, onlineQ] = await Promise.all([
    pool.query(
      `SELECT clerk_user_id, primary_email, first_name, last_name, username, image_url
       FROM clerk_synced_users WHERE clerk_user_id = $1`,
      [hostId],
    ),
    pool.query(
      `SELECT lower(trim(email)) AS email, status
       FROM appointment_participants
       WHERE appointment_id = $1 AND status <> 'declined'
       ORDER BY
         CASE status WHEN 'accepted' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END,
         email`,
      [appt.id],
    ),
    pool.query(
      `SELECT clerk_user_id FROM room_presence
       WHERE appointment_id = $1
         AND last_seen_at >= now() - ($2::numeric * interval '1 second')`,
      [appt.id, PRESENCE_TTL_SECONDS],
    ),
  ])

  const onlineIds = new Set(
    onlineQ.rows.map((r) => r.clerk_user_id).filter(Boolean),
  )

  /** @type {{ clerkUserId: string | null, imageUrl: string | null, displayId: string, email: string, role: 'host'|'invitee', participantStatus?: string }[]} */
  const members = []
  const seenClerk = new Set()

  if (hostQ.rows.length) {
    const row = hostQ.rows[0]
    const hostEmail = row.primary_email?.trim().toLowerCase() ?? ''
    members.push({
      role: 'host',
      clerkUserId: row.clerk_user_id,
      imageUrl: row.image_url ?? null,
      displayId: displayIdFromSyncRow(row),
      email: hostEmail || `host:${hostId}`,
    })
    if (row.clerk_user_id) seenClerk.add(row.clerk_user_id)
  } else {
    members.push({
      role: 'host',
      clerkUserId: hostId,
      imageUrl: null,
      displayId: hostId.slice(0, 12),
      email: `host:${hostId}`,
    })
    seenClerk.add(hostId)
  }

  const emails = participantQ.rows.map((r) => r.email).filter(Boolean)
  /** @type {Map<string, import('pg').QueryResultRow>} */
  const syncByEmail = new Map()

  if (emails.length) {
    const sq = await pool.query(
      `SELECT clerk_user_id, primary_email, first_name, last_name, username, image_url
       FROM clerk_synced_users
       WHERE lower(trim(primary_email)) = ANY($1::text[])`,
      [emails],
    )
    for (const row of sq.rows) {
      const k = row.primary_email?.trim().toLowerCase()
      if (k) syncByEmail.set(k, row)
    }
  }

  for (const row of participantQ.rows) {
    const em = row.email
    if (!em) continue
    const participantStatus =
      row.status === 'accepted' || row.status === 'invited' ? row.status : 'invited'

    const sync = syncByEmail.get(em)
    if (sync?.clerk_user_id && seenClerk.has(sync.clerk_user_id)) continue

    if (sync) {
      const cid = sync.clerk_user_id
      if (cid) seenClerk.add(cid)
      members.push({
        role: 'invitee',
        clerkUserId: cid ?? null,
        imageUrl: sync.image_url ?? null,
        displayId: displayIdFromSyncRow(sync),
        email: em,
        participantStatus,
      })
      continue
    }

    members.push({
      role: 'invitee',
      clerkUserId: null,
      imageUrl: null,
      displayId: em.split('@')[0] || em,
      email: em,
      participantStatus,
    })
  }

  return members.map((m) => ({
    ...m,
    isOnline: Boolean(m.clerkUserId && onlineIds.has(m.clerkUserId)),
  }))
}
