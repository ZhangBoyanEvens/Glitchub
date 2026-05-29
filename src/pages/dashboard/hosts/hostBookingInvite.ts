import type { HostBookingRecord } from './hostBookingStorage.ts'

export type HostBookingInviteeInput = {
  clerkUserId: string
  displayName: string
  firstName?: string | null
  lastName?: string | null
  identifier?: string | null
  /** Invitee email (when identifier is an email); stored in Neon for cancel notifications */
  email?: string | null
}

export type HostBookingInviteApiBody = Pick<
  HostBookingRecord,
  'orgId' | 'hostUserId' | 'dateISO' | 'timeStart'
> & {
  hostProfile: {
    firstName?: string | null
    lastName?: string | null
    identifier?: string | null
  }
  invitees: HostBookingInviteeInput[]
}

export type SendHostBookingInviteOptions = {
  getToken?: () => Promise<string | null>
}

/**
 * Persist booking + invitees to Neon; requires DATABASE_URL + CLERK_SECRET_KEY.
 * On 503 or missing config, skips quietly and still works with localStorage.
 */
export async function sendHostBookingInvite(
  body: HostBookingInviteApiBody,
  options?: SendHostBookingInviteOptions,
): Promise<{ neonInvitationId?: string; roomId?: string }> {
  const getToken = options?.getToken
  if (!getToken) {
    return {}
  }

  const token = await getToken()
  if (!token) {
    throw new Error('Could not get a session token. Please sign in again.')
  }

  const res = await fetch('/api/host-invitations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (res.status === 503) {
    console.warn(
      '[host-invite] Database not configured; skipping Neon write',
    )
    return {}
  }

  if (!res.ok) {
    let message = `Save failed (${res.status})`
    try {
      const j = (await res.json()) as { message?: string }
      if (j?.message) message = j.message
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  const data = (await res.json()) as {
    invitation?: { id?: string }
    appointment?: { roomId?: string }
  }
  const neonInvitationId = data.invitation?.id
  const roomId = data.appointment?.roomId
  if (!neonInvitationId && !roomId) return {}
  return {
    ...(neonInvitationId ? { neonInvitationId } : {}),
    ...(roomId ? { roomId } : {}),
  }
}

export type CancelHostInvitationResult = {
  sent: number
  failed: number
  mailSkipped: boolean
  /** Row already removed (duplicate click or cleaned up) */
  notFound?: boolean
}

/**
 * Host cancels a Neon booking: sends cancel emails then deletes host_invitations.
 */
export async function cancelHostInvitation(
  invitationId: string,
  options: { getToken: () => Promise<string | null> },
): Promise<CancelHostInvitationResult> {
  const token = await options.getToken()
  if (!token) {
    throw new Error('Could not get a session token. Please sign in again.')
  }

  const res = await fetch(
    `/api/host-invitations/${encodeURIComponent(invitationId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  if (res.status === 503) {
    throw new Error('Database not configured; cannot cancel cloud booking.')
  }

  if (res.status === 404) {
    return { sent: 0, failed: 0, mailSkipped: true, notFound: true }
  }

  if (!res.ok) {
    let message = `Cancel failed (${res.status})`
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
    mailSkipped?: boolean
  }
  return {
    sent: Number(data.sent ?? 0),
    failed: Number(data.failed ?? 0),
    mailSkipped: Boolean(data.mailSkipped),
  }
}
