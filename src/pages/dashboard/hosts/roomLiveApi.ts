import type { RoomGameSession } from './roomGameSessionApi.ts'

import type { RoomMemberApi } from './roomMembersApi.ts'

import type { RoomGameVoteValue } from './roomGameVotesApi.ts'

import type { WishPoolGameRef } from './roomWishPoolApi.ts'



export type RoomLiveWishPool = {

  gameIds: number[]

  games: WishPoolGameRef[]

}



export type RoomLiveVoteRow = {

  clerkUserId: string

  vote: RoomGameVoteValue

  gameTitle: string | null

  updatedAt?: string

}



export type RoomLiveSnapshot = RoomGameSession & {

  members: RoomMemberApi[]

  votes: RoomLiveVoteRow[]

  wishPool: RoomLiveWishPool

  readiness?: {

    onlineMembers: string[]

    readyMembers: string[]

    allReady: boolean

    onlineCount: number

    readyCount: number

  }

  progress?: {

    ready: string

    wishPool: string

    voting: string

  }

  serverTime?: string

}



function parseSession(data: Record<string, unknown>): RoomGameSession {

  return {

    started: Boolean(data.started),

    startedAt: (data.startedAt as string) ?? null,

    startedByClerkUserId: (data.startedByClerkUserId as string) ?? null,

    isHost: Boolean(data.isHost),

    roomKind: data.roomKind === 'instant' ? 'instant' : 'scheduled',

    joinCode: (data.joinCode as string) ?? null,

    scheduledAt: (data.scheduledAt as string) ?? null,

    canEndRoom: Boolean(data.canEndRoom),

    vetoLimit: Number(data.vetoLimit) || 2,

    vetoUsed: Number(data.vetoUsed) || 0,

    vetoRemaining: Number(data.vetoRemaining) || 2,

    roomPhase: (data.roomPhase as RoomGameSession['roomPhase']) ?? 'LOBBY',

    roomRound: Number(data.roomRound) || 0,

    playerReady:

      data.playerReady && typeof data.playerReady === 'object'

        ? (data.playerReady as Record<string, boolean>)

        : {},

    selfReady: Boolean(data.selfReady),

    activeSpin: (data.activeSpin as RoomGameSession['activeSpin']) ?? null,

    finalGameId: data.finalGameId != null ? Number(data.finalGameId) : null,

    finalGameTitle: (data.finalGameTitle as string) ?? null,

  }

}



export async function getRoomLiveSnapshot(

  roomId: string,

  options: { getToken: () => Promise<string | null> },

): Promise<RoomLiveSnapshot> {

  const token = await options.getToken()

  if (!token) throw new Error('Please sign in first.')

  const rid = encodeURIComponent(roomId.trim())

  const res = await fetch(`/api/rooms/${rid}/live`, {

    headers: { Authorization: `Bearer ${token}` },

  })

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {

    message?: string

  }

  if (res.status === 503) throw new Error('Database is not configured on the server.')

  if (!res.ok) throw new Error((data.message as string) ?? `Sync failed (${res.status})`)



  const session = parseSession(data)

  const members = Array.isArray(data.members) ? (data.members as RoomMemberApi[]) : []

  const votes = Array.isArray(data.votes) ? (data.votes as RoomLiveVoteRow[]) : []

  const wishPool = (data.wishPool as RoomLiveWishPool) ?? { gameIds: [0, 0, 0], games: [] }



  return { ...session, members, votes, wishPool, readiness: data.readiness as RoomLiveSnapshot['readiness'], progress: data.progress as RoomLiveSnapshot['progress'], serverTime: data.serverTime as string | undefined }

}

