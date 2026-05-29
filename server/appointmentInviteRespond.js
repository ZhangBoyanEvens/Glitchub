/**
 * Public invite response: accept (→ room_id) or decline (→ participant declined).
 * POST /api/appointment-invite/respond
 * Body: { acceptToken?: string, declineToken?: string } — exactly one.
 */
export function registerAppointmentInviteRespondRoutes(app, pool) {
  app.post('/api/appointment-invite/respond', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const acceptToken =
      typeof req.body?.acceptToken === 'string' ? req.body.acceptToken.trim() : ''
    const declineToken =
      typeof req.body?.declineToken === 'string'
        ? req.body.declineToken.trim()
        : ''

    if ((acceptToken && declineToken) || (!acceptToken && !declineToken)) {
      res.status(400).json({
        ok: false,
        message: 'Send exactly one of acceptToken or declineToken',
      })
      return
    }

    try {
      if (acceptToken) {
        const upd = await pool.query(
          `UPDATE appointment_participants ap
           SET status = 'accepted', updated_at = now()
           WHERE ap.accept_token = $1 AND ap.status = 'invited'
           RETURNING ap.id, ap.appointment_id`,
          [acceptToken],
        )
        if (upd.rows.length) {
          const { appointment_id: appointmentId } = upd.rows[0]
          const r2 = await pool.query(
            `SELECT room_id FROM appointments WHERE id = $1`,
            [appointmentId],
          )
          const roomId = r2.rows[0]?.room_id ?? null
          res.json({
            ok: true,
            action: 'accepted',
            roomId,
            appointmentId,
          })
          return
        }

        const existing = await pool.query(
          `SELECT ap.status, a.room_id, ap.appointment_id
           FROM appointment_participants ap
           JOIN appointments a ON a.id = ap.appointment_id
           WHERE ap.accept_token = $1`,
          [acceptToken],
        )
        if (existing.rows.length && existing.rows[0].status === 'accepted') {
          res.json({
            ok: true,
            action: 'accepted',
            roomId: existing.rows[0].room_id,
            appointmentId: existing.rows[0].appointment_id,
            alreadyAccepted: true,
          })
          return
        }

        res.status(404).json({
          ok: false,
          message: 'Invalid or expired accept link',
        })
        return
      }

      const dUp = await pool.query(
        `UPDATE appointment_participants
         SET status = 'declined', updated_at = now()
         WHERE decline_token = $1 AND status = 'invited'
         RETURNING id`,
        [declineToken],
      )
      if (dUp.rows.length) {
        res.json({ ok: true, action: 'declined' })
        return
      }

      const dEx = await pool.query(
        `SELECT status FROM appointment_participants WHERE decline_token = $1`,
        [declineToken],
      )
      if (dEx.rows.length && dEx.rows[0].status === 'declined') {
        res.json({ ok: true, action: 'declined', alreadyDeclined: true })
        return
      }

      res.status(404).json({
        ok: false,
        message: 'Invalid or expired decline link',
      })
    } catch (err) {
      console.error('[appointment-invite/respond]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
