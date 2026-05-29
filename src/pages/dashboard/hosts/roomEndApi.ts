export async function endRoom(

  roomId: string,

  options: { getToken: () => Promise<string | null> },

): Promise<void> {

  const token = await options.getToken()

  if (!token) throw new Error('Please sign in first.')

  const rid = encodeURIComponent(roomId.trim())

  const res = await fetch(`/api/rooms/${rid}/end`, {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${token}`,

    },

    body: '{}',

  })

  const data = (await res.json().catch(() => ({}))) as {

    ok?: boolean

    message?: string

    scheduledAt?: string

  }

  if (!res.ok) {

    if (data.message === 'Only the host can end the room') {

      throw new Error('Only the host can end the room')

    }

    if (data.message === 'ROOM_END_BEFORE_SCHEDULED') {

      const at = data.scheduledAt ? new Date(data.scheduledAt) : null

      const hint =

        at && !Number.isNaN(at.getTime())

          ? `Scheduled time has not arrived yet (you can end the room after ${at.toLocaleString('en-US')})`

          : 'Scheduled time has not arrived yet; the room cannot be ended now'

      throw new Error(hint)

    }

    throw new Error(data.message ?? `Failed to end room (${res.status})`)

  }

}

