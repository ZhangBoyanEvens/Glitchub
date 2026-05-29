export type RoomGameVoteValue = 'approve' | 'reject'

export type RoomGameVotePostResult = {
  vote: RoomGameVoteValue
  gameStarted: boolean
  vetoUsed: number
  vetoRemaining: number
  vetoLimit: number
}

export async function postRoomGameVote(
  roomId: string,
  body: { vote: RoomGameVoteValue; gameTitle?: string | null },
  options: { getToken: () => Promise<string | null> },
): Promise<RoomGameVotePostResult> {
  const token = await options.getToken()
  if (!token) throw new Error('Please sign in first.')
  const rid = encodeURIComponent(roomId.trim())
  const res = await fetch(`/api/rooms/${rid}/votes`, {
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
    vote?: RoomGameVoteValue
    gameStarted?: boolean
    vetoUsed?: number
    vetoRemaining?: number
    vetoLimit?: number
  }
  if (!res.ok) {
    if (data.message === 'VETO_LIMIT_REACHED') {
      throw new Error('Veto limit reached (2 per person)')
    }
    throw new Error(data.message ?? `Failed to vote (${res.status})`)
  }
  return {
    vote: data.vote ?? body.vote,
    gameStarted: Boolean(data.gameStarted),
    vetoUsed: data.vetoUsed ?? 0,
    vetoRemaining: data.vetoRemaining ?? 0,
    vetoLimit: data.vetoLimit ?? 2,
  }
}
