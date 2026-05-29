/**
 * 预约 scheduled_at 过后超过 N 小时，自动从 Neon 删除（级联 host_invitations）。
 * 临时房间 rm_* 为 ephemeral：到期即清理，无论是否曾进入。
 *
 * 环境变量：
 * - ROOM_AUTO_EXPIRE_HOURS（默认 6）
 * - ROOM_EXPIRE_SWEEP_INTERVAL_MS（默认 900000 = 15 分钟）
 */

/** @returns {number} */
export function roomAutoExpireHours() {
  const raw = process.env.ROOM_AUTO_EXPIRE_HOURS?.trim()
  if (!raw) return 6
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 6
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ deleted: number; invitationIds: string[]; roomIds: string[] }>}
 */
export async function purgeStaleUnenteredRooms(pool) {
  const hours = roomAutoExpireHours()

  const { rows } = await pool.query(
    `SELECT
       hi.id AS invitation_id,
       a.id AS appointment_id,
       a.room_id
     FROM appointments a
     INNER JOIN host_invitations hi ON hi.id = a.host_invitation_id
     WHERE a.status <> 'cancelled'
       AND a.scheduled_at + ($1::numeric * interval '1 hour') < now()`,
    [hours],
  )

  if (!rows.length) {
    return { deleted: 0, invitationIds: [], roomIds: [] }
  }

  const invitationIds = rows.map((r) => r.invitation_id)
  const roomIds = rows.map((r) => r.room_id).filter(Boolean)

  await pool.query(`DELETE FROM host_invitations WHERE id = ANY($1::uuid[])`, [
    invitationIds,
  ])

  return {
    deleted: invitationIds.length,
    invitationIds,
    roomIds,
  }
}

/**
 * 删除已取消的预约（优先删 host_invitations 以级联 appointment）。
 *
 * @param {import('pg').Pool} pool
 * @param {{ id: string, host_invitation_id?: string | null }} appt
 */
export async function deleteCancelledAppointmentRecord(pool, appt) {
  if (!appt?.id) return
  if (appt.host_invitation_id) {
    await pool.query(`DELETE FROM host_invitations WHERE id = $1`, [
      appt.host_invitation_id,
    ])
    return
  }
  await pool.query(`DELETE FROM appointments WHERE id = $1`, [appt.id])
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ deleted: number; roomIds: string[] }>}
 */
export async function purgeCancelledRooms(pool) {
  const { rows } = await pool.query(
    `SELECT id, host_invitation_id, room_id
     FROM appointments
     WHERE status = 'cancelled'`,
  )

  if (!rows.length) {
    return { deleted: 0, roomIds: [] }
  }

  const invitationIds = []
  const orphanIds = []
  for (const row of rows) {
    if (row.host_invitation_id) invitationIds.push(row.host_invitation_id)
    else orphanIds.push(row.id)
  }

  if (invitationIds.length) {
    await pool.query(`DELETE FROM host_invitations WHERE id = ANY($1::uuid[])`, [
      invitationIds,
    ])
  }
  if (orphanIds.length) {
    await pool.query(`DELETE FROM appointments WHERE id = ANY($1::uuid[])`, [
      orphanIds,
    ])
  }

  return {
    deleted: rows.length,
    roomIds: rows.map((r) => r.room_id).filter(Boolean),
  }
}

/** @returns {number} */
export function instantEmptyGraceSeconds() {
  const raw = process.env.ROOM_INSTANT_EMPTY_GRACE_SECONDS?.trim()
  if (!raw) return 45
  const n = Number(raw)
  return Number.isFinite(n) && n >= 15 ? n : 45
}

/**
 * 现场房间：全员离线超过 grace 秒后删除（新建房间至少保留 90 秒以免误删）。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ deleted: number; roomIds: string[] }>}
 */
export async function purgeEmptyInstantRooms(pool) {
  const grace = instantEmptyGraceSeconds()
  const minAgeSec = 90

  const { rows } = await pool.query(
    `SELECT a.id, a.room_id
     FROM appointments a
     WHERE a.room_kind = 'instant'
       AND a.status <> 'cancelled'
       AND a.created_at < now() - ($2::numeric * interval '1 second')
       AND COALESCE(
         (SELECT MAX(p.last_seen_at)
          FROM room_presence p
          WHERE p.appointment_id = a.id),
         a.created_at
       ) < now() - ($1::numeric * interval '1 second')`,
    [grace, minAgeSec],
  )

  if (!rows.length) {
    return { deleted: 0, roomIds: [] }
  }

  const ids = rows.map((r) => r.id)
  const roomIds = rows.map((r) => r.room_id).filter(Boolean)
  await pool.query(`DELETE FROM appointments WHERE id = ANY($1::uuid[])`, [ids])

  return { deleted: ids.length, roomIds }
}

/**
 * @param {import('pg').Pool} pool
 */
export function startRoomExpireScheduler(pool) {
  const intervalMs = (() => {
    const raw = process.env.ROOM_EXPIRE_SWEEP_INTERVAL_MS?.trim()
    const n = raw ? Number(raw) : 15 * 60 * 1000
    return Number.isFinite(n) && n >= 60_000 ? n : 15 * 60 * 1000
  })()

  const run = async () => {
    try {
      const stale = await purgeStaleUnenteredRooms(pool)
      if (stale.deleted > 0) {
        console.log(
          `[room-expire] Deleted ${stale.deleted} expired scheduled room(s) (scheduled_at + ${roomAutoExpireHours()}h):`,
          stale.roomIds.join(', '),
        )
      }

      const cancelled = await purgeCancelledRooms(pool)
      if (cancelled.deleted > 0) {
        console.log(
          `[room-expire] Deleted ${cancelled.deleted} cancelled room(s):`,
          cancelled.roomIds.join(', '),
        )
      }

      const emptyInstant = await purgeEmptyInstantRooms(pool)
      if (emptyInstant.deleted > 0) {
        console.log(
          `[room-expire] Deleted ${emptyInstant.deleted} empty instant room(s) (all members left):`,
          emptyInstant.roomIds.join(', '),
        )
      }
    } catch (err) {
      console.error('[room-expire] sweep failed:', err?.message ?? err)
    }
  }

  void run()
  const timer = setInterval(() => void run(), intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
}
