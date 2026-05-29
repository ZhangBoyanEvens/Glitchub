/**
 * 仅首次进入时写库，避免 presence 心跳每次 UPDATE appointments。
 *
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 */
export function markAppointmentEntered(pool, appointmentId) {
  if (!appointmentId) return Promise.resolve()
  return pool
    .query(
      `UPDATE appointments
       SET first_entered_at = now(), updated_at = now()
       WHERE id = $1 AND first_entered_at IS NULL`,
      [appointmentId],
    )
    .catch((err) => {
      const code = err && typeof err === 'object' && 'code' in err ? err.code : ''
      if (code === '42703') return
      console.warn('[appointmentEntered]', err?.message ?? err)
    })
}
