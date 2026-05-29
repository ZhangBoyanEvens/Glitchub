import { useCallback, useEffect, useState } from 'react'
import {
  clearRoomCaseDrawLogs,
  getRoomCaseDrawLogs,
  type RoomCaseDrawLog,
} from './roomCaseDrawLogsApi.ts'
import { GameCoverImage } from './GameCoverImage.tsx'

const POLL_MS = 5000

type Props = {
  roomId: string
  getToken: () => Promise<string | null>
  selfUserId: string | undefined
}

function formatLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

export function RoomCaseDrawLogsPanel({ roomId, getToken, selfUserId }: Props) {
  const [logs, setLogs] = useState<RoomCaseDrawLog[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async () => {
    const rid = roomId.trim()
    if (!rid) {
      setLogs([])
      return
    }
    try {
      const list = await getRoomCaseDrawLogs(rid, { getToken })
      setLogs(list)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [roomId, getToken])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(t)
  }, [load])

  const handleClear = async () => {
    const rid = roomId.trim()
    if (!rid || clearing || !logs?.length) return
    if (
      !window.confirm(
        'Clear all draw logs for this room? This cannot be undone.',
      )
    ) {
      return
    }
    setClearing(true)
    setErr(null)
    try {
      await clearRoomCaseDrawLogs(rid, { getToken })
      setLogs([])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <header className="roomCase__panelHead roomCase__panelHead--logs">
        <h4 className="roomCase__panelTitle">Logs</h4>
        <button
          type="button"
          className="roomCase__logClearBtn"
          disabled={clearing || logs === null || logs.length === 0}
          onClick={() => void handleClear()}
        >
          {clearing ? 'Clearing…' : 'Clear'}
        </button>
      </header>
      <div className="roomCase__panelBody roomCase__panelBody--logs">
        {err ? (
          <p className="roomCase__panelErr" role="alert">
            {err}
          </p>
        ) : logs === null ? (
          <p className="roomCase__panelMuted">Loading logs…</p>
        ) : logs.length === 0 ? (
          <p className="roomCase__panelMuted">No draw logs yet</p>
        ) : (
          <ol className="roomCase__logList">
            {logs.map((log) => {
              const isSelf = Boolean(
                selfUserId && log.clerkUserId && log.clerkUserId === selfUserId,
              )
              return (
                <li
                  key={log.id}
                  className={`roomCase__logItem roomCase__logItem--t${Math.min(6, Math.max(1, log.tierRank))}`}
                >
                  <time className="roomCase__logTime" dateTime={log.createdAt}>
                    {formatLogTime(log.createdAt)}
                  </time>
                  <GameCoverImage
                    gameId={log.gameId}
                    title={log.gameTitle}
                    className="gameCover--sm"
                  />
                  <span className="roomCase__logGame">{log.gameTitle}</span>
                  <span className="roomCase__logMeta">
                    T{log.tierRank}
                    <span className="roomCase__logSep">·</span>
                    {log.displayId}
                    {isSelf ? ' (you)' : ''}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </>
  )
}
