import { useCallback, useEffect, useRef, useState } from 'react'
import { getRoomLiveSnapshot, type RoomLiveSnapshot } from './roomLiveApi.ts'
import { deleteRoomPresence, postRoomPresence } from './roomMembersApi.ts'
import {
  postForceReadyLock,
  postRoomReady,
  startRoomGame,
  type RoomGameSession,
} from './roomGameSessionApi.ts'
import type { RoomGameVoteValue } from './roomGameVotesApi.ts'
import { mapRoomActionError } from './roomUxCopy.ts'

const LIVE_POLL_MS = Number(import.meta.env.VITE_ROOM_LIVE_POLL_MS ?? 2000)
const PRESENCE_BEAT_MS = Number(import.meta.env.VITE_ROOM_PRESENCE_MS ?? 30_000)

export function useRoomLiveSync(
  roomId: string,
  getToken: () => Promise<string | null>,
) {
  const [snapshot, setSnapshot] = useState<RoomLiveSnapshot | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [readyBusy, setReadyBusy] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)
  const [startNotice, setStartNotice] = useState(false)
  const hydratedRef = useRef(false)
  const wasStartedRef = useRef(false)

  const applySession = useCallback((snap: RoomGameSession) => {
    if (!hydratedRef.current) {
      hydratedRef.current = true
      if (snap.started) wasStartedRef.current = true
      return
    }
    if (snap.started && !wasStartedRef.current && !snap.isHost) {
      setStartNotice(true)
    }
    if (snap.started) wasStartedRef.current = true
  }, [])

  const loadLive = useCallback(async () => {
    const rid = roomId.trim()
    if (!rid) return
    try {
      const live = await getRoomLiveSnapshot(rid, { getToken })
      applySession(live)
      setSnapshot(live)
      setLoadErr(null)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e))
    }
  }, [roomId, getToken, applySession])

  useEffect(() => {
    hydratedRef.current = false
    wasStartedRef.current = false
    setStartNotice(false)
    setSnapshot(null)
    void loadLive()
    const t = window.setInterval(() => void loadLive(), LIVE_POLL_MS)
    return () => window.clearInterval(t)
  }, [loadLive])

  useEffect(() => {
    const rid = roomId.trim()
    if (!rid) return
    const beat = () => void postRoomPresence(rid, { getToken })
    beat()
    const t = window.setInterval(beat, PRESENCE_BEAT_MS)
    return () => {
      window.clearInterval(t)
      void deleteRoomPresence(rid, { getToken })
    }
  }, [roomId, getToken])

  const handleReadyToggle = useCallback(async () => {
    const rid = roomId.trim()
    if (!rid || readyBusy || !snapshot) return
    setReadyBusy(true)
    try {
      const snap = await postRoomReady(rid, !snapshot.selfReady, { getToken })
      setSnapshot((prev) => (prev ? { ...prev, ...snap } : prev))
      setLoadErr(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLoadErr(mapRoomActionError(msg))
    } finally {
      setReadyBusy(false)
    }
  }, [roomId, getToken, readyBusy, snapshot])

  const handleForceLock = useCallback(async () => {
    const rid = roomId.trim()
    if (!rid || lockBusy) return
    setLockBusy(true)
    try {
      const snap = await postForceReadyLock(rid, { getToken })
      setSnapshot((prev) => (prev ? { ...prev, ...snap } : prev))
      setLoadErr(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLoadErr(mapRoomActionError(msg))
    } finally {
      setLockBusy(false)
    }
  }, [roomId, getToken, lockBusy])

  const handleStart = useCallback(async () => {
    const rid = roomId.trim()
    if (!rid || starting) return
    setStarting(true)
    setLoadErr(null)
    try {
      const snap = await startRoomGame(rid, { getToken })
      setSnapshot((prev) =>
        prev
          ? { ...prev, ...snap }
          : {
              ...snap,
              members: [],
              votes: [],
              wishPool: { gameIds: [0, 0, 0], games: [] },
            },
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLoadErr(mapRoomActionError(msg))
    } finally {
      setStarting(false)
    }
  }, [roomId, getToken, starting])

  const dismissStartNotice = useCallback(() => setStartNotice(false), [])

  const votesForTitle = useCallback(
    (gameTitle: string): Map<string, RoomGameVoteValue> => {
      const map = new Map<string, RoomGameVoteValue>()
      const title = gameTitle.trim()
      if (!snapshot?.votes?.length || !title) return map
      for (const row of snapshot.votes) {
        if (!row.clerkUserId) continue
        if (row.gameTitle === title) map.set(row.clerkUserId, row.vote)
      }
      return map
    },
    [snapshot?.votes],
  )

  return {
    snapshot,
    members: snapshot?.members ?? null,
    session: snapshot,
    loadErr,
    starting,
    startNotice,
    dismissStartNotice,
    handleStart,
    handleReadyToggle,
    handleForceLock,
    readyBusy,
    lockBusy,
    reloadLive: loadLive,
    votesForTitle,
    wishPool: snapshot?.wishPool ?? null,
    liveTick: snapshot?.serverTime ?? '',
  }
}
