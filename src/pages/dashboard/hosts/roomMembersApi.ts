export type RoomMemberRole = 'host' | 'invitee'

export type RoomMemberParticipantStatus = 'invited' | 'accepted'

export type RoomMemberApi = {
  clerkUserId: string | null
  imageUrl: string | null
  displayId: string
  email: string
  role: RoomMemberRole
  participantStatus?: RoomMemberParticipantStatus
  isOnline: boolean
  ready?: boolean
  reputation?: {
    attendanceRate: number
    lateJoinRate: number
    noShowRate: number
    roomCompletionRate: number
    reliabilityScore: number
    badge: 'Reliable' | 'Average' | 'Risky'
  } | null
}

/** In-room presence heartbeat; call periodically while on the room page */
export async function postRoomPresence(
  roomId: string,
  options: { getToken: () => Promise<string | null> },
): Promise<void> {
  const token = await options.getToken()
  if (!token) return
  const rid = encodeURIComponent(roomId.trim())
  const res = await fetch(`/api/rooms/${rid}/presence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: '{}',
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
  if (!res.ok && res.status !== 401) {
    console.warn('[room presence]', data.message ?? res.status)
  }
}

/** Leave room presence when navigating away */
export async function deleteRoomPresence(
  roomId: string,
  options: { getToken: () => Promise<string | null> },
): Promise<void> {
  const token = await options.getToken()
  if (!token) return
  const rid = encodeURIComponent(roomId.trim())
  try {
    await fetch(`/api/rooms/${rid}/presence`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    /* best-effort */
  }
}
