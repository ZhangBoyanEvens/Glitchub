export type HostInvitationListItem = {

  id: string

  orgId: string

  hostUserId: string

  dateISO: string

  timeStart: string

  createdAt: string

  roomId: string | null

  appointmentStatus: string | null

  isHost: boolean

  invitees: { clerkUserId: string; displayName: string }[]

}



export type FetchMyHostInvitationsOptions = {

  orgId: string

  getToken: () => Promise<string | null>

}



/**

 * GET /api/host-invitations?orgId= — bookings where the current user is host or invitee.

 */

export async function fetchMyHostInvitations(

  options: FetchMyHostInvitationsOptions,

): Promise<HostInvitationListItem[]> {

  const { orgId, getToken } = options

  const token = await getToken()

  if (!token) {

    throw new Error('Please sign in to view booking history.')

  }



  const qs = new URLSearchParams({ orgId })

  const res = await fetch(`/api/host-invitations?${qs}`, {

    headers: { Authorization: `Bearer ${token}` },

  })



  if (res.status === 503) {

    throw new Error('Database is not configured on the server.')

  }



  const data = (await res.json().catch(() => ({}))) as {

    ok?: boolean

    message?: string

    invitations?: HostInvitationListItem[]

  }



  if (!res.ok) {

    throw new Error(data.message ?? `Failed to load (${res.status})`)

  }



  if (!data.ok || !Array.isArray(data.invitations)) {

    throw new Error(data.message ?? 'Invalid booking list data')

  }



  return data.invitations

}

