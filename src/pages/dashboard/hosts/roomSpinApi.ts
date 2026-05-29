import type { RoomSpinStartEvent } from './roomSpinTypes.ts'



export async function postRoomSpin(

  roomId: string,

  options: { getToken: () => Promise<string | null> },

): Promise<RoomSpinStartEvent> {

  const token = await options.getToken()

  if (!token) throw new Error('Please sign in first.')

  const rid = encodeURIComponent(roomId.trim())

  const res = await fetch(`/api/rooms/${rid}/spin`, {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${token}`,

    },

    body: '{}',

  })

  const data = (await res.json().catch(() => ({}))) as RoomSpinStartEvent & {

    ok?: boolean

    message?: string

  }

  if (!res.ok) {

    throw new Error(data.message ?? `Failed to start spin (${res.status})`)

  }

  if (!data.spinId || data.eventType !== 'ROOM_SPIN_START') {

    throw new Error('Incomplete response data')

  }

  return data

}



export async function fetchLatestRoomSpin(

  roomId: string,

  options: { getToken: () => Promise<string | null> },

): Promise<{

  spin: RoomSpinStartEvent | null

  isComplete: boolean

  serverTimestamp: number

} | null> {

  const token = await options.getToken()

  if (!token) return null

  const rid = encodeURIComponent(roomId.trim())

  const res = await fetch(`/api/rooms/${rid}/spin/latest`, {

    headers: { Authorization: `Bearer ${token}` },

  })

  const data = (await res.json().catch(() => ({}))) as {

    ok?: boolean

    spin?: RoomSpinStartEvent | null

    isComplete?: boolean

    serverTimestamp?: number

    message?: string

  }

  if (!res.ok) return null

  return {

    spin: data.spin ?? null,

    isComplete: Boolean(data.isComplete),

    serverTimestamp: Number(data.serverTimestamp) || Date.now(),

  }

}

