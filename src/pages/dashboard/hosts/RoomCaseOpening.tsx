import { flushSync } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchReferenceGamesCatalogDetailed,
  type ReferenceCatalogCategory,
} from './referenceGamesCatalogApi.ts'
import { WIN_INDEX, reelTranslateXToCenterCell } from './roomCaseMetrics.ts'
import { RoomGameSessionBar } from './RoomGameSessionBar.tsx'
import type { RoomGameSession } from './roomGameSessionApi.ts'
import { RoomCaseDrawLogsPanel } from './RoomCaseDrawLogsPanel.tsx'
import { RoomCaseProbabilityPanel } from './RoomCaseProbabilityPanel.tsx'
import { GameCoverImage } from './GameCoverImage.tsx'
import { endRoom } from './roomEndApi.ts'
import { postRoomSpin } from './roomSpinApi.ts'
import type { RoomSpinStartEvent, SpinSyncPhase } from './roomSpinTypes.ts'
import { useRoomSpinSocket } from './useRoomSpinSocket.ts'
import { phaseAllowsHostSpin } from './roomFsmPhases.ts'
import {
  buildDeterministicStrip,
  flattenPoolDeterministic,
  type StripCell,
} from './spinStrip.ts'
import type { RoomLastGameResult } from './roomLastResult.ts'
import './roomCaseOpening.css'

type RoomCaseOpeningProps = {
  roomId: string
  getToken: () => Promise<string | null>
  selfUserId: string | undefined
  wishGameIds: number[]
  onLastResultChange?: (result: RoomLastGameResult | null) => void
  gameSession: RoomGameSession | null
  gameSessionLoadErr: string | null
  gameStartNotice: boolean
  onDismissGameStartNotice: () => void
  isHost: boolean
  onRoomEnded?: () => void
  onFsmSync?: () => void
}

type WinPick = StripCell

function clampTier(t: number): number {
  return Math.min(6, Math.max(1, Math.round(t)))
}

function formatScheduledAt(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US')
}

function nowWithOffset(offsetMs: number): number {
  return Date.now() + offsetMs
}

/**
 * 服务端权威 seed + 同步时间轴；禁止本地 Math.random 决定结果。
 */
export function RoomCaseOpening({
  roomId,
  getToken,
  selfUserId,
  wishGameIds,
  onLastResultChange,
  gameSession,
  gameSessionLoadErr,
  gameStartNotice,
  onDismissGameStartNotice,
  isHost,
  onRoomEnded,
  onFsmSync,
}: RoomCaseOpeningProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const spinSessionRef = useRef(0)
  const fallbackTimerRef = useRef<number | null>(null)
  const revealTimerRef = useRef<number | null>(null)
  const transitionEndRef = useRef<((e: TransitionEvent) => void) | null>(null)
  const serverTimeOffsetRef = useRef(0)

  const [categories, setCategories] = useState<ReferenceCatalogCategory[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [stripCells, setStripCells] = useState<StripCell[] | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [syncPhase, setSyncPhase] = useState<SpinSyncPhase>('idle')
  const [endingRoom, setEndingRoom] = useState(false)
  const [endRoomErr, setEndRoomErr] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [lastResultPick, setLastResultPick] = useState<StripCell | null>(null)
  const [showRevealFx, setShowRevealFx] = useState(false)

  const publishLastResult = useCallback(
    (pick: WinPick | null) => {
      const title = pick?.title ?? null
      setLastResult(title)
      setLastResultPick(pick ? { ...pick } : null)
      onLastResultChange?.(
        pick ? { title: pick.title, id: pick.id } : null,
      )
    },
    [onLastResultChange],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setCatalogLoading(true)
      try {
        const cats = await fetchReferenceGamesCatalogDetailed()
        if (!cancelled) {
          setCategories(cats)
          setLoadErr(null)
        }
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setCatalogLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const clearFallback = useCallback(() => {
    if (fallbackTimerRef.current != null) {
      window.clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
  }, [])

  const clearRevealTimer = useCallback(() => {
    if (revealTimerRef.current != null) {
      window.clearTimeout(revealTimerRef.current)
      revealTimerRef.current = null
    }
  }, [])

  const revealFromEvent = useCallback(
    (event: RoomSpinStartEvent) => {
      clearRevealTimer()
      clearFallback()
      const pick: WinPick = {
        id: event.resultGameId,
        title: event.resultGameTitle,
        tier_rank: clampTier(event.tierRank),
      }
      setSpinning(false)
      setSyncPhase('revealed')
      setShowRevealFx(true)
      publishLastResult(pick)
      window.setTimeout(() => setShowRevealFx(false), 1200)
    },
    [clearFallback, clearRevealTimer, publishLastResult],
  )

  const runDeterministicSpin = useCallback(
    (event: RoomSpinStartEvent) => {
      if (!categories.length) return

      const win: WinPick = {
        id: event.resultGameId,
        title: event.resultGameTitle,
        tier_rank: clampTier(event.tierRank),
      }
      const pool = flattenPoolDeterministic(categories)
      const strip = buildDeterministicStrip(win, pool, event.seed)
      const session = ++spinSessionRef.current

      flushSync(() => {
        setStripCells(strip)
        setSpinning(true)
        setSyncPhase('spinning')
      })

      const vp = viewportRef.current
      const reel = stripRef.current
      if (!vp || !reel) {
        revealFromEvent(event)
        return
      }

      if (transitionEndRef.current) {
        reel.removeEventListener('transitionend', transitionEndRef.current)
        transitionEndRef.current = null
      }
      clearFallback()

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const durationSec = reduced ? 0.12 : event.spinDuration / 1000

      const offset = serverTimeOffsetRef.current
      const revealDelay = Math.max(0, event.revealTimestamp - nowWithOffset(offset))
      revealTimerRef.current = window.setTimeout(() => {
        revealFromEvent(event)
      }, revealDelay)

      const runSpin = () => {
        if (session !== spinSessionRef.current) return

        reel.style.transition = 'none'
        reel.style.transform = 'translateX(0px)'
        void reel.offsetHeight

        const startX = reelTranslateXToCenterCell(vp, reel, 0)
        const endX = reelTranslateXToCenterCell(vp, reel, WIN_INDEX)
        reel.style.transform = `translateX(${startX}px)`
        void reel.offsetHeight

        const onEnd = (e: TransitionEvent) => {
          if (e.propertyName !== 'transform') return
          reel.removeEventListener('transitionend', onEnd)
          transitionEndRef.current = null
        }
        transitionEndRef.current = onEnd
        reel.addEventListener('transitionend', onEnd)

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (session !== spinSessionRef.current) return
            reel.style.transition = reduced
              ? 'transform 0.12s linear'
              : `transform ${durationSec}s cubic-bezier(0.18, 0.92, 0.24, 1)`
            reel.style.transform = `translateX(${endX}px)`
          })
        })

        fallbackTimerRef.current = window.setTimeout(
          () => {
            /* reveal 由 revealTimestamp 触发 */
          },
          reduced ? 200 : event.spinDuration + 500,
        )
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(runSpin)
      })
    },
    [categories, clearFallback, revealFromEvent],
  )

  const applySpinEvent = useCallback(
    (event: RoomSpinStartEvent) => {
      serverTimeOffsetRef.current = event.serverTimestamp - Date.now()
      const offset = serverTimeOffsetRef.current
      const syncedNow = nowWithOffset(offset)

      if (syncedNow >= event.revealTimestamp) {
        const pool = categories.length ? flattenPoolDeterministic(categories) : []
        const win: WinPick = {
          id: event.resultGameId,
          title: event.resultGameTitle,
          tier_rank: clampTier(event.tierRank),
        }
        if (pool.length) {
          setStripCells(buildDeterministicStrip(win, pool, event.seed))
        }
        revealFromEvent(event)
        return
      }

      setSyncPhase('syncing')
      const delay = Math.max(0, event.serverTimestamp - syncedNow)
      window.setTimeout(() => {
        runDeterministicSpin(event)
      }, delay)
    },
    [categories, revealFromEvent, runDeterministicSpin],
  )

  useRoomSpinSocket({
    roomId,
    getToken,
    enabled: Boolean(roomId.trim()),
    onSpinStart: applySpinEvent,
    onRoomStateChanged: onFsmSync,
  })

  useEffect(
    () => () => {
      clearFallback()
      clearRevealTimer()
      const reel = stripRef.current
      if (reel && transitionEndRef.current) {
        reel.removeEventListener('transitionend', transitionEndRef.current)
        transitionEndRef.current = null
      }
    },
    [clearFallback, clearRevealTimer],
  )

  const handleOpen = async () => {
    const rid = roomId.trim()
    if (!isHost || !categories.length || spinning || syncPhase === 'syncing') return
    setSyncPhase('syncing')
    setLoadErr(null)
    try {
      const event = await postRoomSpin(rid, { getToken })
      applySpinEvent(event)
    } catch (e) {
      setSyncPhase('idle')
      setLoadErr(e instanceof Error ? e.message : String(e))
    }
  }

  const canSpin =
    isHost &&
    categories.length > 0 &&
    !loadErr &&
    phaseAllowsHostSpin(gameSession?.roomPhase)
  const canEndRoom = isHost && (gameSession?.canEndRoom ?? false)
  const scheduledAtLabel = formatScheduledAt(gameSession?.scheduledAt)
  const busy = spinning || syncPhase === 'syncing'

  const handleEndRoom = async () => {
    const rid = roomId.trim()
    if (!isHost || !rid || endingRoom || busy || !canEndRoom) return
    if (
      !window.confirm(
        'End this room session? After ending, no one can open cases or vote.',
      )
    ) {
      return
    }
    setEndingRoom(true)
    setEndRoomErr(null)
    try {
      await endRoom(rid, { getToken })
      onRoomEnded?.()
    } catch (e) {
      setEndRoomErr(e instanceof Error ? e.message : String(e))
    } finally {
      setEndingRoom(false)
    }
  }

  return (
    <section
      className={`roomCase${showRevealFx ? ' roomCase--revealFx' : ''}`}
      aria-label="Case opening"
    >
      <div className="roomCase__upper">
        <header className="roomCase__head">
          <h3 className="roomCase__title">Open case</h3>
          <RoomGameSessionBar
            session={gameSession}
            loadErr={gameSessionLoadErr}
            startNotice={gameStartNotice}
            onDismissNotice={onDismissGameStartNotice}
          />
          {syncPhase === 'syncing' ? (
            <p className="roomCase__meta roomCase__sync" role="status">
              Syncing draw…
            </p>
          ) : null}
          {loadErr ? (
            <p className="roomCase__meta roomCase__meta--err" role="alert">
              {loadErr}
            </p>
          ) : null}
        </header>

        <div className="roomCase__unbox">
          <div className="roomCase__viewport" ref={viewportRef}>
            <div className="roomCase__pointerCol" aria-hidden>
              <div className="roomCase__pointerTri roomCase__pointerTri--top" />
              <div className="roomCase__pointerTri roomCase__pointerTri--bottom" />
            </div>
            <div className="roomCase__reel" ref={stripRef}>
              {stripCells?.map((cell, i) => {
                const t = clampTier(cell.tier_rank)
                return (
                  <div
                    key={`${i}-${cell.id}-${cell.title}`}
                    className={`roomCase__cell roomCase__cell--t${t}`}
                  >
                    <GameCoverImage
                      gameId={cell.id}
                      title={cell.title}
                      className="gameCover--reel"
                    />
                    <span className="roomCase__name">{cell.title}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="roomCase__lower" role="region" aria-label="Case opening lower panels">
        <section className="roomCase__panel" aria-label="Draw logs">
          <RoomCaseDrawLogsPanel
            roomId={roomId}
            getToken={getToken}
            selfUserId={selfUserId}
          />
        </section>
        <section className="roomCase__panel" aria-label="This draw result">
          <header className="roomCase__panelHead">
            <h4 className="roomCase__panelTitle">This result</h4>
          </header>
          <div className="roomCase__panelBody roomCase__panelBody--result">
            {lastResult ? (
              <div className="roomCase__resultBlock">
                <GameCoverImage
                  gameId={lastResultPick?.id}
                  title={lastResult}
                  className="gameCover--md"
                />
                <p className="roomCase__result">
                  This result: <strong>{lastResult}</strong>
                </p>
              </div>
            ) : null}
          </div>
        </section>
        <section className="roomCase__panel" aria-label="Probability odds">
          <RoomCaseProbabilityPanel
            categories={categories}
            wishGameIds={wishGameIds}
            loadErr={loadErr}
            loading={catalogLoading}
          />
        </section>
      </div>

      <footer className="roomCase__footer">
        {!isHost ? (
          <p className="roomCase__footerHint">
            Only the host can open cases; you will see synced animation after the host starts
          </p>
        ) : !canEndRoom && scheduledAtLabel ? (
          <p className="roomCase__footerHint">
            You can end the room after scheduled time {scheduledAtLabel}
          </p>
        ) : endRoomErr ? (
          <p className="roomCase__footerErr" role="alert">
            {endRoomErr}
          </p>
        ) : null}
        <div className="roomCase__footerActions">
          {isHost ? (
            <button
              type="button"
              className="roomCase__btn roomCase__btn--end"
              disabled={endingRoom || busy || !canEndRoom}
              title={
                !canEndRoom && scheduledAtLabel
                  ? `You can end the room after scheduled time ${scheduledAtLabel}`
                  : undefined
              }
              onClick={() => void handleEndRoom()}
            >
              {endingRoom ? 'Ending…' : 'End room'}
            </button>
          ) : null}
          <button
            type="button"
            className="roomCase__btn roomCase__btn--open"
            disabled={!canSpin || busy || endingRoom}
            title={!isHost ? 'Only the host can open cases' : undefined}
            onClick={() => void handleOpen()}
          >
            {syncPhase === 'syncing'
              ? 'Syncing…'
              : spinning
                ? 'Spinning…'
                : 'Open case'}
          </button>
        </div>
      </footer>
    </section>
  )
}
