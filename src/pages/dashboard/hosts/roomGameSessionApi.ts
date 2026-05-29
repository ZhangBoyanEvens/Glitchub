import type { RoomPhase } from './roomFsmPhases.ts'

import type { RoomSpinStartEvent } from './roomSpinTypes.ts'

import { mapRoomActionError } from './roomUxCopy.ts'



export type RoomGameSession = {

  started: boolean

  startedAt: string | null

  startedByClerkUserId: string | null

  isHost: boolean

  roomKind: 'scheduled' | 'instant'

  joinCode: string | null

  scheduledAt: string | null

  canEndRoom: boolean

  vetoLimit: number

  vetoUsed: number

  vetoRemaining: number

  roomPhase: RoomPhase

  roomRound: number

  playerReady: Record<string, boolean>

  selfReady: boolean

  activeSpin: RoomSpinStartEvent | null

  finalGameId: number | null

  finalGameTitle: string | null

}



type RoomGameSessionPayload = Partial<RoomGameSession> & {

  ok?: boolean

  message?: string

}



function parseRoomGameSession(

  data: RoomGameSessionPayload,

  overrides?: Partial<Pick<RoomGameSession, 'started' | 'isHost'>>,

): RoomGameSession {

  return {

    started: overrides?.started ?? Boolean(data.started),

    startedAt: data.startedAt ?? null,

    startedByClerkUserId: data.startedByClerkUserId ?? null,

    isHost: overrides?.isHost ?? Boolean(data.isHost),

    roomKind: data.roomKind === 'instant' ? 'instant' : 'scheduled',

    joinCode: data.joinCode ?? null,

    scheduledAt: data.scheduledAt ?? null,

    canEndRoom: Boolean(data.canEndRoom),

    vetoLimit: data.vetoLimit ?? 2,

    vetoUsed: data.vetoUsed ?? 0,

    vetoRemaining: data.vetoRemaining ?? 2,

    roomPhase: (data.roomPhase as RoomPhase) ?? 'LOBBY',

    roomRound: Number(data.roomRound) || 0,

    playerReady:

      data.playerReady && typeof data.playerReady === 'object'

        ? (data.playerReady as Record<string, boolean>)

        : {},

    selfReady: Boolean(data.selfReady),

    activeSpin: (data.activeSpin as RoomSpinStartEvent) ?? null,

    finalGameId: data.finalGameId != null ? Number(data.finalGameId) : null,

    finalGameTitle: (data.finalGameTitle as string) ?? null,

  }

}



export async function startRoomGame(

  roomId: string,

  options: { getToken: () => Promise<string | null> },

): Promise<RoomGameSession> {

  const token = await options.getToken()

  if (!token) throw new Error('Please sign in first.')

  const rid = encodeURIComponent(roomId.trim())

  const res = await fetch(`/api/rooms/${rid}/game-session/start`, {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${token}`,

    },

    body: '{}',

  })

  const data = (await res.json().catch(() => ({}))) as RoomGameSessionPayload

  if (!res.ok) {

    if (data.message === 'Only the host can start the game') {

      throw new Error('Only the host can start the game')

    }

    const code = typeof (data as { code?: string }).code === 'string' ? (data as { code?: string }).code : undefined

    throw new Error(mapRoomActionError(data.message ?? `Failed to start game (${res.status})`, code))

  }

  return parseRoomGameSession(data, { started: true, isHost: true })

}



export async function postRoomReady(

  roomId: string,

  ready: boolean,

  options: { getToken: () => Promise<string | null> },

): Promise<RoomGameSession> {

  const token = await options.getToken()

  if (!token) throw new Error('Please sign in first.')

  const rid = encodeURIComponent(roomId.trim())

  const res = await fetch(`/api/rooms/${rid}/game-session/ready`, {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${token}`,

    },

    body: JSON.stringify({ ready }),

  })

  const data = (await res.json().catch(() => ({}))) as RoomGameSessionPayload

  if (!res.ok) throw new Error(data.message ?? `Failed to update ready status (${res.status})`)

  return parseRoomGameSession(data)

}



export async function postForceReadyLock(

  roomId: string,

  options: { getToken: () => Promise<string | null> },

): Promise<RoomGameSession> {

  const token = await options.getToken()

  if (!token) throw new Error('Please sign in first.')

  const rid = encodeURIComponent(roomId.trim())

  const res = await fetch(`/api/rooms/${rid}/game-session/force-lock`, {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${token}`,

    },

    body: '{}',

  })

  const data = (await res.json().catch(() => ({}))) as RoomGameSessionPayload

  if (!res.ok) throw new Error(data.message ?? `Failed to lock ready state (${res.status})`)

  return parseRoomGameSession(data)

}

