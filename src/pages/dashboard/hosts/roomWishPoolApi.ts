export type WishPoolGameRef = {
  id: number
  title: string
}

export type RoomWishPoolSnapshot = {
  gameIds: number[]
  games: WishPoolGameRef[]
  updatedAt: string | null
}

export async function getRoomWishPool(
  roomId: string,
  options: { getToken: () => Promise<string | null> },
): Promise<RoomWishPoolSnapshot | null> {
  const token = await options.getToken()
  if (!token) throw new Error('Please sign in first.')
  const rid = encodeURIComponent(roomId.trim())
  const res = await fetch(`/api/rooms/${rid}/wish-pool`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    message?: string
    wishPool?: RoomWishPoolSnapshot | null
  }
  if (!res.ok) {
    throw new Error(data.message ?? `Failed to load wish pool (${res.status})`)
  }
  if (data.wishPool == null) return null
  return data.wishPool
}

export async function saveRoomWishPool(
  roomId: string,
  gameIds: number[],
  options: { getToken: () => Promise<string | null> },
): Promise<RoomWishPoolSnapshot> {
  const token = await options.getToken()
  if (!token) throw new Error('Please sign in first.')
  const rid = encodeURIComponent(roomId.trim())
  const res = await fetch(`/api/rooms/${rid}/wish-pool`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ gameIds }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    message?: string
    wishPool?: RoomWishPoolSnapshot
  }
  if (!res.ok) {
    throw new Error(data.message ?? `Failed to save wish pool (${res.status})`)
  }
  if (!data.wishPool) throw new Error('Invalid response data')
  return data.wishPool
}
