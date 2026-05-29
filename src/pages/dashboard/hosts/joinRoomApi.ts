import { mapRoomApiMessage } from './roomApiErrors.ts'



const JOIN_ERR: Record<string, string> = {

  'Invalid room id (expected rm_…)': 'Invalid room id (expected rm_…).',

  'Room not found': 'Room not found.',

  'You previously declined this invite.': 'You previously declined this invite.',

  'Only the host or an invited email address (from the booking) can enter this room.':

    'Only the host or an invited email address (from the booking) can enter this room. Confirm your signed-in primary email matches the invite.',

}



/**

 * POST /api/rooms/join — requires Clerk session; email must match invite or be host.

 */

export async function postJoinRoom(

  roomId: string,

  options: { getToken: () => Promise<string | null> },

): Promise<{

  role: 'host' | 'invitee'

  roomId: string

  appointmentId: string

  participantStatus?: string

  scheduledAt?: string

}> {

  const token = await options.getToken()

  if (!token) {

    throw new Error('Please sign in before joining a room.')

  }

  const rid = roomId.trim()

  const res = await fetch('/api/rooms/join', {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${token}`,

    },

    body: JSON.stringify({ roomId: rid }),

  })

  const data = (await res.json().catch(() => ({}))) as {

    message?: string

    role?: 'host' | 'invitee'

    roomId?: string

    appointmentId?: string

    participantStatus?: string

    scheduledAt?: string

  }

  if (res.status === 503) {

    throw new Error('Database is not configured on the server.')

  }

  if (!res.ok) {

    throw new Error(mapRoomApiMessage(data.message, res.status, JOIN_ERR, 'Failed to join room'))

  }

  if (!data.roomId || !data.appointmentId || !data.role) {

    throw new Error('Incomplete response data')

  }

  return {

    role: data.role,

    roomId: data.roomId,

    appointmentId: data.appointmentId,

    participantStatus: data.participantStatus,

    scheduledAt:

      typeof data.scheduledAt === 'string'

        ? data.scheduledAt

        : data.scheduledAt != null

          ? String(data.scheduledAt)

          : undefined,

  }

}

