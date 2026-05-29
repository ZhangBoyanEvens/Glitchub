import { Resend } from 'resend'
import { randomBytes } from 'node:crypto'
import { clerkUserIdFromRequest } from './clerkAuth.js'
import { newRoomId } from './roomIds.js'
import { invitationBccList } from './resendHostInvitationEmail.js'
import { ensureJoinUid } from './joinUid.js'
import { purgeStaleUnenteredRooms } from './roomExpire.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** dateISO YYYY-MM-DD + timeStart HH:mm → ISO string (interpreted as UTC wall clock). */
function scheduledAtUTC(dateISO, timeStart) {
  const d = String(dateISO ?? '').trim()
  const t = String(timeStart ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{1,2}:\d{2}$/.test(t)) {
    return new Date().toISOString()
  }
  const [hh, mm] = t.split(':').map((x) => Number(x))
  const pad = (n) => String(n).padStart(2, '0')
  const iso = `${d}T${pad(hh)}:${pad(mm)}:00.000Z`
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString()
}

function newInviteOpaqueToken() {
  return randomBytes(24).toString('hex')
}

/**
 * @param {import('express').Express} app
 * @param {import('pg').Pool | null} pool
 */
export function registerHostInvitationRoutes(app, pool) {
  /**
   * GET /api/host-invitations?orgId=org_xxx
   * 当前用户作为房主或受邀人的预约列表（含房间号）。
   */
  app.get('/api/host-invitations', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL is not configured' })
      return
    }

    const sessionUserId = await clerkUserIdFromRequest(req)
    if (!sessionUserId) {
      res.status(401).json({ ok: false, message: 'Unauthorized or invalid Clerk session' })
      return
    }

    const orgId =
      typeof req.query.orgId === 'string' ? req.query.orgId.trim() : ''
    if (!orgId) {
      res.status(400).json({ ok: false, message: 'Missing orgId' })
      return
    }

    try {
      try {
        await purgeStaleUnenteredRooms(pool)
      } catch (sweepErr) {
        console.warn(
          '[host-invitations GET] expire sweep:',
          sweepErr?.message ?? sweepErr,
        )
      }

      const { rows } = await pool.query(
        `SELECT
           hi.id,
           hi.org_id,
           hi.host_user_id,
           hi.date_iso::text AS date_iso,
           hi.time_start,
           hi.created_at,
           a.room_id,
           a.status AS appointment_status,
           (hi.host_user_id = $2) AS is_host,
           COALESCE(
             json_agg(
               json_build_object(
                 'clerkUserId', hii.invitee_user_id,
                 'displayName', hii.display_name
               )
               ORDER BY hii.display_name
             ) FILTER (WHERE hii.invitee_user_id IS NOT NULL),
             '[]'::json
           ) AS invitees
         FROM host_invitations hi
         LEFT JOIN appointments a ON a.host_invitation_id = hi.id
         LEFT JOIN host_invitation_invitees hii ON hii.invitation_id = hi.id
         WHERE hi.org_id = $1
           AND (
             hi.host_user_id = $2
             OR EXISTS (
               SELECT 1 FROM host_invitation_invitees x
               WHERE x.invitation_id = hi.id AND x.invitee_user_id = $2
             )
           )
         GROUP BY hi.id, a.room_id, a.status
         ORDER BY hi.date_iso DESC, hi.time_start DESC`,
        [orgId, sessionUserId],
      )

      res.json({
        ok: true,
        invitations: rows.map((r) => ({
          id: r.id,
          orgId: r.org_id,
          hostUserId: r.host_user_id,
          dateISO: r.date_iso,
          timeStart: r.time_start,
          createdAt: r.created_at,
          roomId: r.room_id ?? null,
          appointmentStatus: r.appointment_status ?? null,
          isHost: Boolean(r.is_host),
          invitees: Array.isArray(r.invitees) ? r.invitees : [],
        })),
      })
    } catch (err) {
      console.error('[host-invitations GET]', err)
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ ok: false, message })
    }
  })

  app.post('/api/host-invitations', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL is not configured' })
      return
    }

    const sessionUserId = await clerkUserIdFromRequest(req)
    if (!sessionUserId) {
      res.status(401).json({ ok: false, message: 'Unauthorized or invalid Clerk session' })
      return
    }

    const { orgId, hostUserId, dateISO, timeStart, hostProfile, invitees } =
      req.body ?? {}

    if (sessionUserId !== hostUserId) {
      res.status(403).json({ ok: false, message: 'Signed-in user does not match host' })
      return
    }
    if (!orgId || typeof orgId !== 'string') {
      res.status(400).json({ ok: false, message: 'Missing orgId' })
      return
    }
    if (!dateISO || !timeStart) {
      res.status(400).json({ ok: false, message: 'Missing dateISO or timeStart' })
      return
    }
    if (!Array.isArray(invitees) || invitees.length === 0) {
      res.status(400).json({ ok: false, message: 'invitees must not be empty' })
      return
    }

    for (const inv of invitees) {
      if (!inv?.clerkUserId || typeof inv.clerkUserId !== 'string') {
        res.status(400).json({ ok: false, message: 'invitees entry missing clerkUserId' })
        return
      }
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const hostJoinUid = await ensureJoinUid(client, hostUserId, {
        firstName: hostProfile?.firstName,
        lastName: hostProfile?.lastName,
        identifier: hostProfile?.identifier,
      })

      const inviteePayload = []
      for (const inv of invitees) {
        const joinUid = await ensureJoinUid(client, inv.clerkUserId, {
          firstName: inv.firstName,
          lastName: inv.lastName,
          identifier: inv.identifier,
        })
        const rawEmail =
          typeof inv.email === 'string' ? inv.email.trim().toLowerCase() : ''
        const inviteeEmail = EMAIL_RE.test(rawEmail) ? rawEmail : null
        inviteePayload.push({
          clerkUserId: inv.clerkUserId,
          displayName:
            typeof inv.displayName === 'string' && inv.displayName.trim()
              ? inv.displayName.trim()
              : 'Member',
          joinUid,
          inviteeEmail,
        })
      }

      const hostDisplayName =
        [hostProfile?.firstName, hostProfile?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() ||
        (typeof hostProfile?.identifier === 'string'
          ? hostProfile.identifier.trim()
          : '') ||
        'Host'

      const snapshotJson = JSON.stringify({
        orgId,
        hostUserId,
        hostDisplayName,
        dateISO,
        timeStart,
        invitees: inviteePayload.map((r) => ({
          clerkUserId: r.clerkUserId,
          displayName: r.displayName,
        })),
      })

      const ins = await client.query(
        `INSERT INTO host_invitations
          (org_id, host_user_id, host_join_uid, date_iso, time_start, encrypted_payload)
         VALUES ($1, $2, $3, $4::date, $5, $6)
         RETURNING id`,
        [orgId, hostUserId, hostJoinUid, dateISO, timeStart, snapshotJson],
      )
      const invitationId = ins.rows[0].id

      for (const row of inviteePayload) {
        await client.query(
          `INSERT INTO host_invitation_invitees
            (invitation_id, invitee_user_id, join_uid, display_name, invitee_email)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            invitationId,
            row.clerkUserId,
            row.joinUid,
            row.displayName,
            row.inviteeEmail,
          ],
        )
      }

      const scheduledAt = scheduledAtUTC(dateISO, timeStart)
      const roomId = newRoomId()
      const appt = await client.query(
        `INSERT INTO appointments
          (host_id, scheduled_at, room_id, status, host_invitation_id)
         VALUES ($1, $2::timestamptz, $3, 'pending', $4)
         RETURNING id, room_id`,
        [hostUserId, scheduledAt, roomId, invitationId],
      )
      const appointmentId = appt.rows[0].id
      const appointmentRoomId = appt.rows[0].room_id

      const seenParticipantEmails = new Set()
      for (const row of inviteePayload) {
        if (!row.inviteeEmail) continue
        if (seenParticipantEmails.has(row.inviteeEmail)) continue
        seenParticipantEmails.add(row.inviteeEmail)
        const acceptTok = newInviteOpaqueToken()
        const declineTok = newInviteOpaqueToken()
        await client.query(
          `INSERT INTO appointment_participants
            (appointment_id, email, status, accept_token, decline_token)
           VALUES ($1, $2, 'invited', $3, $4)`,
          [appointmentId, row.inviteeEmail, acceptTok, declineTok],
        )
      }

      await client.query('COMMIT')

      res.status(201).json({
        ok: true,
        invitation: {
          id: invitationId,
          hostJoinUid,
          invitees: inviteePayload.map((r) => ({
            clerkUserId: r.clerkUserId,
            joinUid: r.joinUid,
            displayName: r.displayName,
          })),
        },
        appointment: {
          id: appointmentId,
          roomId: appointmentRoomId,
        },
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[host-invitations]', err)
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ ok: false, message })
    } finally {
      client.release()
    }
  })

  /**
   * 房主取消预约：向受邀人发送取消邮件后删除 Neon 中的邀请记录（级联删除受邀人）。
   * DELETE /api/host-invitations/:invitationId
   */
  app.delete('/api/host-invitations/:invitationId', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL is not configured' })
      return
    }

    const sessionUserId = await clerkUserIdFromRequest(req)
    if (!sessionUserId) {
      res.status(401).json({ ok: false, message: 'Unauthorized or invalid Clerk session' })
      return
    }

    const { invitationId } = req.params
    if (!invitationId || typeof invitationId !== 'string') {
      res.status(400).json({ ok: false, message: 'Missing invitationId' })
      return
    }

    let invRow
    let inviteeRows
    try {
      const q = await pool.query(
        `SELECT id, host_user_id, org_id, date_iso::text AS date_iso, time_start, encrypted_payload
         FROM host_invitations WHERE id = $1`,
        [invitationId],
      )
      if (!q.rows.length) {
        res.status(404).json({ ok: false, message: 'Invitation not found' })
        return
      }
      invRow = q.rows[0]
      if (invRow.host_user_id !== sessionUserId) {
        res.status(403).json({ ok: false, message: 'Only the host can cancel this booking' })
        return
      }

      const iq = await pool.query(
        `SELECT display_name, invitee_email
         FROM host_invitation_invitees WHERE invitation_id = $1`,
        [invitationId],
      )
      inviteeRows = iq.rows
    } catch (err) {
      console.error('[host-invitations DELETE]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    let hostDisplayName = 'Host'
    try {
      const snap = JSON.parse(invRow.encrypted_payload || '{}')
      if (
        typeof snap.hostDisplayName === 'string' &&
        snap.hostDisplayName.trim()
      ) {
        hostDisplayName = snap.hostDisplayName.trim()
      }
    } catch {
      /* ignore */
    }

    const slotLabel = `${invRow.date_iso} ${invRow.time_start}`
    const safeSlot = escapeHtml(slotLabel)
    const safeHost = escapeHtml(hostDisplayName)
    const safeOrg = escapeHtml(invRow.org_id)
    const appOrigin =
      process.env.APP_PUBLIC_ORIGIN?.replace(/\/$/, '') ||
      'http://localhost:5173'

    const resendKey = process.env.RESEND_API_KEY?.trim()
    const from = process.env.RESEND_FROM_EMAIL?.trim()
    let sent = 0
    let failed = 0
    const mailErrors = []

    if (resendKey && from) {
      const resend = new Resend(resendKey)
      const bccList = invitationBccList()
      const subject = `Glitchub · Booking cancelled · ${slotLabel}`

      for (const row of inviteeRows) {
        const email = String(row.invitee_email ?? '')
          .trim()
          .toLowerCase()
        if (!EMAIL_RE.test(email)) {
          continue
        }
        const name =
          typeof row.display_name === 'string' ? row.display_name.trim() : ''
        const safeName = escapeHtml(name || 'Hello')
        const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#111">
  <p>Hi ${safeName},</p>
  <p>The room booking for <strong>「${safeSlot}」</strong> has been cancelled by <strong>${safeHost}</strong>.</p>
  <p>Organization: <code>${safeOrg}</code></p>
  <p>You no longer need the original join code for this session; contact them directly if you have questions.</p>
  <p><a href="${escapeHtml(appOrigin)}/dashboard/hosts/book">${escapeHtml(appOrigin)}/dashboard/hosts/book</a></p>
  <p style="color:#666;font-size:12px">This email was sent via Resend. Please do not reply directly.</p>
</body></html>`

        try {
          const r = await resend.emails.send({
            from,
            to: email,
            subject,
            html,
            ...(bccList ? { bcc: bccList } : {}),
          })
          if (r.error) {
            failed += 1
            mailErrors.push({
              email,
              reason: r.error.message ?? 'resend_error',
            })
          } else {
            sent += 1
          }
        } catch (err) {
          failed += 1
          mailErrors.push({
            email,
            reason: err instanceof Error ? err.message : String(err),
          })
        }
      }
    } else {
      console.warn(
        '[host-invitations DELETE] RESEND_API_KEY or RESEND_FROM_EMAIL not configured; skipping cancellation email',
      )
    }

    try {
      const del = await pool.query(
        `DELETE FROM host_invitations WHERE id = $1`,
        [invitationId],
      )
      if (del.rowCount === 0) {
        res.status(404).json({ ok: false, message: 'Invitation not found' })
        return
      }
    } catch (err) {
      console.error('[host-invitations DELETE] db', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    res.json({
      ok: true,
      cancelled: true,
      sent,
      failed,
      mailSkipped: !resendKey || !from,
      mailErrors: mailErrors.length ? mailErrors : undefined,
    })
  })

  /** 校验加入码是否匹配该邀请的房主或受邀人（不区分大小写） */
  app.post('/api/host-invitations/:invitationId/verify-join', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL is not configured' })
      return
    }
    const { invitationId } = req.params
    const joinUid = String(req.body?.joinUid ?? '')
      .trim()
      .toLowerCase()
    if (!joinUid) {
      res.status(400).json({ ok: false, message: 'Missing joinUid' })
      return
    }

    try {
      const inv = await pool.query(
        `SELECT host_join_uid, host_user_id FROM host_invitations WHERE id = $1`,
        [invitationId],
      )
      if (!inv.rows.length) {
        res.status(404).json({ ok: false, message: 'Invitation not found' })
        return
      }
      const { host_join_uid: hostJoin, host_user_id: hostUserId } = inv.rows[0]
      if (String(hostJoin).toLowerCase() === joinUid) {
        res.json({ ok: true, role: 'host', userId: hostUserId })
        return
      }

      const row = await pool.query(
        `SELECT invitee_user_id FROM host_invitation_invitees
         WHERE invitation_id = $1 AND lower(join_uid) = $2`,
        [invitationId, joinUid],
      )
      if (row.rows.length) {
        res.json({
          ok: true,
          role: 'invitee',
          userId: row.rows[0].invitee_user_id,
        })
        return
      }

      res.status(403).json({ ok: false, message: 'Invalid join code' })
    } catch (err) {
      console.error('[verify-join]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
