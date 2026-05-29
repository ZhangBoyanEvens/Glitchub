import { mapRoomApiMessage } from './roomApiErrors.ts'



const INSTANT_ERR: Record<string, string> = {

  INVALID_JOIN_CODE: 'Enter a 4–6 digit room code.',

  'Room not found': 'Room not found or has been dissolved.',

}



export type InstantRoomEnterResult = {

  role: 'host' | 'invitee'

  roomId: string

  appointmentId: string

  joinCode: string

  scheduledAt?: string

}



export async function postInstantRoomEnter(

  joinCode: string,

  options: { getToken: () => Promise<string | null> },

): Promise<InstantRoomEnterResult> {

  const token = await options.getToken()

  if (!token) throw new Error('Please sign in first.')



  const res = await fetch('/api/rooms/instant/enter', {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${token}`,

    },

    body: JSON.stringify({ joinCode: joinCode.trim() }),

  })

  const data = (await res.json().catch(() => ({}))) as {

    message?: string

    role?: 'host' | 'invitee'

    roomId?: string

    appointmentId?: string

    joinCode?: string

    scheduledAt?: string

  }

  if (res.status === 503) throw new Error('Database is not configured on the server.')

  if (!res.ok) throw new Error(mapRoomApiMessage(data.message, res.status, INSTANT_ERR, 'Failed to enter room'))



  if (!data.roomId || !data.appointmentId || !data.role || !data.joinCode) {

    throw new Error('Incomplete response data')

  }

  return {

    role: data.role,

    roomId: data.roomId,

    appointmentId: data.appointmentId,

    joinCode: data.joinCode,

    scheduledAt:

      typeof data.scheduledAt === 'string' ? data.scheduledAt : undefined,

  }

}



export async function suggestInstantJoinCode(options: {

  getToken: () => Promise<string | null>

}): Promise<string> {

  const token = await options.getToken()

  if (!token) throw new Error('Please sign in first.')



  const res = await fetch('/api/rooms/instant/suggest-code', {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${token}`,

    },

    body: '{}',

  })

  const data = (await res.json().catch(() => ({}))) as {

    joinCode?: string

    message?: string

  }

  if (!res.ok) {

    throw new Error(mapRoomApiMessage(data.message, res.status, INSTANT_ERR, 'Failed to generate room code'))

  }

  if (!data.joinCode) throw new Error('Could not generate a room code')

  return data.joinCode

}

