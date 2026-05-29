const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type HostInvitationEmailRecipient = {
  email: string
  displayName?: string
}

/**
 * Send host booking invite emails via Resend (RESEND_API_KEY + RESEND_FROM_EMAIL).
 * invitationId must exist in Neon; backend checks the current user is the host.
 */
export async function sendHostInvitationResendEmails(
  body: { invitationId: string; recipients: HostInvitationEmailRecipient[] },
  options: { getToken: () => Promise<string | null> },
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  const { invitationId, recipients } = body
  const list = recipients.filter((r) => EMAIL_RE.test(String(r.email ?? '').trim()))
  if (!list.length) {
    return { sent: 0, failed: 0, skipped: true }
  }

  const token = await options.getToken()
  if (!token) {
    throw new Error('Could not get a session token; email not sent.')
  }

  const res = await fetch('/api/email/host-invitation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      invitationId,
      recipients: list.map((r) => ({
        email: String(r.email).trim().toLowerCase(),
        displayName: r.displayName,
      })),
    }),
  })

  if (res.status === 503) {
    console.warn('[resend] Resend or database not configured; skipping email')
    return { sent: 0, failed: 0, skipped: true }
  }

  if (!res.ok) {
    let message = `Email API failed (${res.status})`
    try {
      const j = (await res.json()) as { message?: string }
      if (j?.message) message = j.message
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  const data = (await res.json()) as {
    sent?: number
    failed?: number
  }
  return {
    sent: Number(data.sent ?? 0),
    failed: Number(data.failed ?? 0),
    skipped: false,
  }
}

export function emailFromMemberIdentifier(identifier: string | undefined | null) {
  if (!identifier) return null
  const t = identifier.trim()
  return EMAIL_RE.test(t) ? t.toLowerCase() : null
}
