export type RoomCaseDrawLog = {
  id: string
  clerkUserId: string
  displayId: string
  gameId: number | null
  gameTitle: string
  tierRank: number
  createdAt: string
}

export async function getRoomCaseDrawLogs(
  roomId: string,
  options: { getToken: () => Promise<string | null> },
): Promise<RoomCaseDrawLog[]> {
  const token = await options.getToken()
  if (!token) throw new Error('Please sign in first.')
  const rid = encodeURIComponent(roomId.trim())
  const res = await fetch(`/api/rooms/${rid}/draw-logs`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    message?: string
    logs?: RoomCaseDrawLog[]
  }
  if (!res.ok) {
    throw new Error(data.message ?? `Failed to load draw logs (${res.status})`)
  }
  return Array.isArray(data.logs) ? data.logs : []
}

export async function postRoomCaseDrawLog(
  roomId: string,
  body: { gameId?: number; gameTitle: string; tierRank: number },
  options: { getToken: () => Promise<string | null> },
): Promise<RoomCaseDrawLog> {
  const token = await options.getToken()
  if (!token) throw new Error('Please sign in first.')
  const rid = encodeURIComponent(roomId.trim())
  const res = await fetch(`/api/rooms/${rid}/draw-logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    message?: string
    log?: RoomCaseDrawLog
  }
  if (!res.ok) {
    throw new Error(data.message ?? `Failed to save draw log (${res.status})`)
  }
  if (!data.log) throw new Error('Invalid response data')
  return data.log
}

export async function clearRoomCaseDrawLogs(
  roomId: string,
  options: { getToken: () => Promise<string | null> },
): Promise<number> {
  const token = await options.getToken()
  if (!token) throw new Error('Please sign in first.')
  const rid = encodeURIComponent(roomId.trim())
  const res = await fetch(`/api/rooms/${rid}/draw-logs`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    message?: string
    deletedCount?: number
  }
  if (!res.ok) {
    throw new Error(data.message ?? `Failed to clear logs (${res.status})`)
  }
  return typeof data.deletedCount === 'number' ? data.deletedCount : 0
}
