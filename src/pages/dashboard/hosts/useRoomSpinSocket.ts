import { useCallback, useEffect, useRef } from 'react'
import type { RoomSpinStartEvent } from './roomSpinTypes.ts'
import { fetchLatestRoomSpin } from './roomSpinApi.ts'

function wsBaseUrl(roomId: string, token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  const rid = encodeURIComponent(roomId.trim())
  return `${proto}//${host}/api/rooms/${rid}/ws?token=${encodeURIComponent(token)}`
}

type Options = {
  roomId: string
  getToken: () => Promise<string | null>
  enabled: boolean
  onSpinStart: (event: RoomSpinStartEvent) => void
  onRoomStateChanged?: () => void
}

/**
 * 订阅房间 WebSocket；ROOM_SPIN_START 由服务端广播，客户端不得本地随机。
 */
export function useRoomSpinSocket({
  roomId,
  getToken,
  enabled,
  onSpinStart,
  onRoomStateChanged,
}: Options) {
  const onSpinStartRef = useRef(onSpinStart)
  const onStateRef = useRef(onRoomStateChanged)
  const seenSpinIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    onSpinStartRef.current = onSpinStart
  }, [onSpinStart])

  useEffect(() => {
    onStateRef.current = onRoomStateChanged
  }, [onRoomStateChanged])

  const handlePayload = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as Record<string, unknown>
    if (p.eventType === 'ROOM_STATE_CHANGED') {
      onStateRef.current?.()
      return
    }
    if (p.eventType !== 'ROOM_SPIN_START') return
    const spinId = String(p.spinId ?? '')
    if (!spinId || seenSpinIdsRef.current.has(spinId)) return
    seenSpinIdsRef.current.add(spinId)

    const event: RoomSpinStartEvent = {
      eventType: 'ROOM_SPIN_START',
      spinId,
      roomId: String(p.roomId ?? ''),
      seed: Number(p.seed),
      resultGameId: Number(p.resultGameId),
      resultGameTitle: String(p.resultGameTitle ?? ''),
      tierRank: Number(p.tierRank) || 1,
      serverTimestamp: Number(p.serverTimestamp),
      spinDuration: Number(p.spinDuration) || 3500,
      revealTimestamp: Number(p.revealTimestamp),
    }
    onSpinStartRef.current(event)
  }, [])

  useEffect(() => {
    const rid = roomId.trim()
    if (!enabled || !rid) return

    let ws: WebSocket | null = null
    let cancelled = false
    let retryTimer: number | null = null

    const connect = async () => {
      const token = await getToken()
      if (!token || cancelled) return

      try {
        const latest = await fetchLatestRoomSpin(rid, { getToken })
        if (latest?.spin && !seenSpinIdsRef.current.has(latest.spin.spinId)) {
          handlePayload(latest.spin)
        }
      } catch {
        /* 恢复失败不阻断 WS */
      }

      if (cancelled) return

      ws = new WebSocket(wsBaseUrl(rid, token))
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as unknown
          if (
            data &&
            typeof data === 'object' &&
            (data as { eventType?: string }).eventType === 'CONNECTED' &&
            typeof (data as { serverTimestamp?: number }).serverTimestamp === 'number'
          ) {
            return
          }
          handlePayload(data)
        } catch {
          /* ignore */
        }
      }
      ws.onclose = () => {
        if (!cancelled) {
          retryTimer = window.setTimeout(() => void connect(), 2500)
        }
      }
      ws.onerror = () => {
        ws?.close()
      }
    }

    seenSpinIdsRef.current = new Set()
    void connect()

    return () => {
      cancelled = true
      if (retryTimer != null) window.clearTimeout(retryTimer)
      ws?.close()
    }
  }, [roomId, getToken, enabled, handlePayload])
}
