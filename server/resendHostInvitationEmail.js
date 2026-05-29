import { Resend } from 'resend'
import { randomBytes } from 'node:crypto'
import { clerkUserIdFromRequest } from './clerkAuth.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** BCC for invite/cancel mail (see .env.example) */
export function invitationBccList() {
  const raw = process.env.RESEND_HOST_INVITATION_BCC?.trim().toLowerCase()
  if (!raw || !EMAIL_RE.test(raw)) return undefined
  return [raw]
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function appointmentSlug(appointmentId) {
  return `app-${String(appointmentId).replace(/-/g, '')}`
}

/**
 * Load participant invite tokens; mint if missing (older rows).
 * @param {import('pg').Pool} pool
 */
async function loadOrMintInviteTokens(pool, invitationId, email) {
  const r0 = await pool.query(
    `SELECT ap.accept_token, ap.decline_token, a.id AS appointment_id
     FROM appointment_participants ap
     JOIN appointments a ON a.id = ap.appointment_id
     WHERE a.host_invitation_id = $1 AND lower(trim(ap.email)) = lower(trim($2))`,
    [invitationId, email],
  )
  if (!r0.rows.length) return null
  let accept_token = r0.rows[0].accept_token
  let decline_token = r0.rows[0].decline_token
  const appointment_id = r0.rows[0].appointment_id
  if (!accept_token || !decline_token) {
    const t1 = randomBytes(24).toString('hex')
    const t2 = randomBytes(24).toString('hex')
    const up = await pool.query(
      `UPDATE appointment_participants ap
       SET accept_token = COALESCE(ap.accept_token, $1),
           decline_token = COALESCE(ap.decline_token, $2)
       FROM appointments a
       WHERE ap.appointment_id = a.id
         AND a.host_invitation_id = $3
         AND lower(trim(ap.email)) = lower(trim($4))
       RETURNING ap.accept_token, ap.decline_token`,
      [t1, t2, invitationId, email],
    )
    if (up.rows.length) {
      accept_token = up.rows[0].accept_token
      decline_token = up.rows[0].decline_token
    }
  }
  return { accept_token, decline_token, appointment_id }
}

function inviteButtonsHtml(acceptUrl, declineUrl) {
  const a = escapeHtml(acceptUrl)
  const d = escapeHtml(declineUrl)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;">
<tr>
<td style="border-radius:10px;background:#7c3aed;">
<a href="${a}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-weight:700;text-decoration:none;font-family:system-ui,sans-serif;">Accept invite</a>
</td>
<td width="14"></td>
<td style="border-radius:10px;background:#64748b;">
<a href="${d}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-weight:700;text-decoration:none;font-family:system-ui,sans-serif;">Decline</a>
</td>
</tr>
</table>`
}

/**
 * Resend host booking invite email. Requires RESEND_API_KEY, RESEND_FROM_EMAIL; host must own invitation.
 *
 * POST /api/email/host-invitation
 * Body: { invitationId: string, recipients: [{ email: string, displayName?: string }] }
 */
export function registerResendHostInvitationEmailRoutes(app, pool) {
  app.post('/api/email/host-invitation', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL is not configured' })
      return
    }
    if (!process.env.RESEND_API_KEY) {
      res.status(503).json({
        ok: false,
        code: 'RESEND_NOT_CONFIGURED',
        message: 'RESEND_API_KEY is not configured; cannot send email',
      })
      return
    }
    const from = process.env.RESEND_FROM_EMAIL?.trim()
    if (!from) {
      res.status(503).json({
        ok: false,
        code: 'RESEND_FROM_MISSING',
        message: 'RESEND_FROM_EMAIL is not configured',
      })
      return
    }

    const sessionUserId = await clerkUserIdFromRequest(req)
    if (!sessionUserId) {
      res.status(401).json({ ok: false, message: 'Unauthorized or invalid Clerk session' })
      return
    }

    const { invitationId, recipients } = req.body ?? {}
    if (!invitationId || typeof invitationId !== 'string') {
      res.status(400).json({ ok: false, message: 'Missing invitationId' })
      return
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ ok: false, message: 'recipients must not be empty' })
      return
    }

    let invRow
    try {
      const q = await pool.query(
        `SELECT id, host_user_id, org_id, date_iso::text AS date_iso, time_start
         FROM host_invitations WHERE id = $1`,
        [invitationId],
      )
      if (!q.rows.length) {
        res.status(404).json({ ok: false, message: 'Invitation not found' })
        return
      }
      invRow = q.rows[0]
    } catch (err) {
      console.error('[email/host-invitation]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (invRow.host_user_id !== sessionUserId) {
      res.status(403).json({ ok: false, message: 'Only the host can send email for this invitation' })
      return
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const bccList = invitationBccList()
    const appOrigin =
      process.env.APP_PUBLIC_ORIGIN?.replace(/\/$/, '') ||
      'http://localhost:5173'

    const subject = `Glitchub room booking invite · ${invRow.date_iso} ${invRow.time_start}`

    const sent = []
    const failed = []

    for (const r of recipients) {
      const email = String(r?.email ?? '')
        .trim()
        .toLowerCase()
      if (!EMAIL_RE.test(email)) {
        failed.push({ email, reason: 'invalid_email' })
        continue
      }
      const name = typeof r?.displayName === 'string' ? r.displayName.trim() : ''
      const safeName = escapeHtml(name || 'Hello')
      const safeDate = escapeHtml(invRow.date_iso)
      const safeTime = escapeHtml(invRow.time_start)
      const safeOrg = escapeHtml(invRow.org_id)

      const tokens = await loadOrMintInviteTokens(pool, invitationId, email)
      let buttons = ''
      if (
        tokens?.accept_token &&
        tokens?.decline_token &&
        tokens?.appointment_id
      ) {
        const slug = appointmentSlug(tokens.appointment_id)
        const acceptUrl = `${appOrigin}/book/${slug}?token=${encodeURIComponent(tokens.accept_token)}`
        const declineUrl = `${appOrigin}/book/${slug}?declineToken=${encodeURIComponent(tokens.decline_token)}`
        buttons = inviteButtonsHtml(acceptUrl, declineUrl)
      }

      const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#111">
  <p>Hi ${safeName},</p>
  <p>You received a <strong>Glitchub</strong> room booking invitation (org <code>${safeOrg}</code>).</p>
  <p><strong>Date</strong>: ${safeDate}<br/><strong>Start time</strong>: ${safeTime}</p>
  ${buttons}
  <p>Clicking <strong>Accept</strong> confirms your invitation; the page will show this session's <strong>room_id</strong> (use it later to enter the room).</p>
  <p>You can also open the app later: <a href="${escapeHtml(appOrigin)}/dashboard/hosts/book">${escapeHtml(appOrigin)}/dashboard/hosts/book</a></p>
  <p style="color:#666;font-size:12px">This email was sent via Resend. Please do not reply directly.</p>
</body></html>`

      try {
        const { data, error } = await resend.emails.send({
          from,
          to: email,
          subject,
          html,
          ...(bccList ? { bcc: bccList } : {}),
        })
        if (error) {
          failed.push({ email, reason: error.message ?? 'resend_error' })
        } else {
          sent.push({ email, id: data?.id })
        }
      } catch (err) {
        failed.push({
          email,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }

    res.json({
      ok: failed.length === 0,
      sent: sent.length,
      failed: failed.length,
      details: { sent, failed },
    })
  })
}
