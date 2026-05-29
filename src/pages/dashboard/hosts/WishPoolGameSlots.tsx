import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  fetchReferenceGamesFlat,
  type ReferenceCatalogGame,
} from './referenceGamesCatalogApi.ts'
import {
  getRoomWishPool,
  saveRoomWishPool,
  type RoomWishPoolSnapshot,
  type WishPoolGameRef,
} from './roomWishPoolApi.ts'
import type { RoomLiveWishPool } from './roomLiveApi.ts'
import {
  WISH_POOL_NONE_GAME,
  isWishPoolNoneGame,
} from './wishPoolConstants.ts'
import { GameCoverImage } from './GameCoverImage.tsx'

const SLOT_COUNT = 3
const WISH_POOL_BODY_SEL = '.dashboard__hostsLiveRoomWishPoolBody'

type SlotValue = ReferenceCatalogGame | null

type FlyoutStyle = {
  position: 'fixed'
  top: number
  left: number
  width: number
  maxHeight: number
  zIndex: number
}

type Props = {
  roomId: string
  getToken: () => Promise<string | null>
  onSavedGameIdsChange: (gameIds: number[]) => void
  /** 由 /live 合并接口同步，有则不再单独轮询 GET wish-pool */
  liveWishPool?: RoomLiveWishPool | null
  liveTick?: string
  readOnly?: boolean
  onAfterSave?: () => void
}

function gamesToSlots(games: WishPoolGameRef[]): SlotValue[] {
  return games.map((g) => ({ id: g.id, title: g.title, sort_order: 0 }))
}

function slotsToGameIds(slots: SlotValue[]): number[] {
  return slots.map((s) => s?.id ?? 0)
}

function emptySlots(): SlotValue[] {
  return Array.from({ length: SLOT_COUNT }, () => null)
}

/**
 * 许愿池：三槽选游戏 → 保存后全房间概率 +50%/位（可叠同游戏）→ Cancel 重新编辑。
 */
function liveToSnapshot(live: RoomLiveWishPool): RoomWishPoolSnapshot {
  return { gameIds: live.gameIds, games: live.games, updatedAt: null }
}

export function WishPoolGameSlots({
  roomId,
  getToken,
  onSavedGameIdsChange,
  liveWishPool,
  liveTick,
  readOnly = false,
  onAfterSave,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<(HTMLDivElement | null)[]>([])
  const [draft, setDraft] = useState<SlotValue[]>(emptySlots)
  const [saved, setSaved] = useState<RoomWishPoolSnapshot | null>(null)
  const [isEditing, setIsEditing] = useState(true)
  const [openSlot, setOpenSlot] = useState<number | null>(null)
  const [catalog, setCatalog] = useState<ReferenceCatalogGame[] | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogErr, setCatalogErr] = useState<string | null>(null)
  const [flyoutStyle, setFlyoutStyle] = useState<FlyoutStyle | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isEditingRef = useRef(isEditing)

  useEffect(() => {
    isEditingRef.current = isEditing
  }, [isEditing])

  const locked = readOnly || (Boolean(saved) && !isEditing)
  const allFilled = draft.every((s) => s != null)

  const setSlotRef = useCallback((index: number, el: HTMLDivElement | null) => {
    slotRefs.current[index] = el
  }, [])

  const applySnapshot = useCallback(
    (snap: RoomWishPoolSnapshot | null, options?: { lockUi?: boolean }) => {
      if (snap) {
        setSaved(snap)
        onSavedGameIdsChange(snap.gameIds)
        if (options?.lockUi || !isEditingRef.current) {
          setDraft(gamesToSlots(snap.games))
          setIsEditing(false)
          isEditingRef.current = false
        }
      } else {
        setSaved(null)
        onSavedGameIdsChange([])
        if (options?.lockUi || !isEditingRef.current) {
          setDraft(emptySlots())
          setIsEditing(true)
          isEditingRef.current = true
        }
      }
    },
    [onSavedGameIdsChange],
  )

  const loadPool = useCallback(async () => {
    const rid = roomId.trim()
    if (!rid) {
      applySnapshot(null)
      return
    }
    try {
      const snap = await getRoomWishPool(rid, { getToken })
      applySnapshot(snap)
      setLoadErr(null)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e))
    }
  }, [roomId, getToken, applySnapshot])

  useEffect(() => {
    if (liveWishPool != null) {
      const snap =
        liveWishPool.games.length > 0
          ? liveToSnapshot(liveWishPool)
          : null
      applySnapshot(snap, { lockUi: true })
      return
    }
    void loadPool()
  }, [liveWishPool, liveTick, loadPool, applySnapshot])

  useEffect(() => {
    if (liveWishPool != null) return
    void loadPool()
  }, [liveWishPool, loadPool])

  const ensureCatalog = useCallback(async () => {
    if (catalog !== null || catalogLoading) return
    setCatalogLoading(true)
    setCatalogErr(null)
    try {
      const list = await fetchReferenceGamesFlat()
      setCatalog(list)
    } catch (e) {
      setCatalogErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCatalogLoading(false)
    }
  }, [catalog, catalogLoading])

  const toggleSlot = useCallback(
    (index: number) => {
      if (locked) return
      setOpenSlot((prev) => (prev === index ? null : index))
    },
    [locked],
  )

  useEffect(() => {
    if (openSlot === null) return
    queueMicrotask(() => {
      void ensureCatalog()
    })
  }, [openSlot, ensureCatalog])

  const pickGame = useCallback(
    (slotIndex: number, game: ReferenceCatalogGame) => {
      if (locked) return
      setDraft((prev) => {
        const next = [...prev]
        next[slotIndex] = game
        return next
      })
      setOpenSlot(null)
      setActionErr(null)
    },
    [locked],
  )

  const pickNone = useCallback(
    (slotIndex: number) => {
      if (locked) return
      setDraft((prev) => {
        const next = [...prev]
        next[slotIndex] = WISH_POOL_NONE_GAME
        return next
      })
      setOpenSlot(null)
      setActionErr(null)
    },
    [locked],
  )

  const handleSave = async () => {
    const rid = roomId.trim()
    if (!rid || !allFilled || saving) return
    setSaving(true)
    setActionErr(null)
    try {
      const snap = await saveRoomWishPool(rid, slotsToGameIds(draft), { getToken })
      applySnapshot(snap, { lockUi: true })
      onAfterSave?.()
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /** 已保存状态下：进入编辑，可改选 */
  const handleCancelToEdit = () => {
    setActionErr(null)
    setOpenSlot(null)
    if (saved) {
      setDraft(gamesToSlots(saved.games))
    }
    setIsEditing(true)
    isEditingRef.current = true
  }

  /** 编辑中：恢复为上次保存的选项，保持可编辑 */
  const handleCancelRevert = () => {
    setActionErr(null)
    setOpenSlot(null)
    if (saved) {
      setDraft(gamesToSlots(saved.games))
    } else {
      setDraft(emptySlots())
    }
    setIsEditing(true)
    isEditingRef.current = true
  }

  useLayoutEffect(() => {
    if (openSlot === null) {
      queueMicrotask(() => setFlyoutStyle(null))
      return
    }

    const updateLayout = () => {
      const el = slotRefs.current[openSlot]
      if (!el) return
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const margin = 10
      const maxPanelW = 300
      const panelW = Math.min(maxPanelW, vw - margin * 2)
      let left = r.right + 6
      if (left + panelW > vw - margin) {
        left = Math.max(margin, r.left - panelW - 6)
      }
      const maxH = Math.min(440, vh - r.top - margin)
      setFlyoutStyle({
        position: 'fixed',
        top: r.top,
        left,
        width: panelW,
        maxHeight: maxH,
        zIndex: 80,
      })
    }

    updateLayout()

    const el = slotRefs.current[openSlot]
    const scrollParent = el?.closest(WISH_POOL_BODY_SEL) ?? null

    window.addEventListener('resize', updateLayout)
    scrollParent?.addEventListener('scroll', updateLayout, { passive: true })

    return () => {
      window.removeEventListener('resize', updateLayout)
      scrollParent?.removeEventListener('scroll', updateLayout)
    }
  }, [openSlot, draft])

  useEffect(() => {
    if (openSlot === null) return
    const onDocDown = (e: MouseEvent) => {
      const t = e.target
      if (!(t instanceof Node) || !rootRef.current?.contains(t)) {
        setOpenSlot(null)
      }
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [openSlot])

  const activeSlot = openSlot

  return (
    <div className="dashboard__hostsWishPoolRoot">
      {loadErr ? (
        <p className="dashboard__hostsWishPickerErr" role="alert">
          {loadErr}
        </p>
      ) : null}
      <div className="dashboard__hostsWishPoolMain">
        {locked ? (
          <p className="dashboard__hostsWishPoolStatus">Saved</p>
        ) : (
          <p className="dashboard__hostsWishPoolStatus">Pick 3 games to save</p>
        )}

        <div ref={rootRef} className="dashboard__hostsWishSlots">
        {Array.from({ length: SLOT_COUNT }, (_, index) => {
          const picked = draft[index]
          const isOpen = openSlot === index
          return (
            <div
              key={index}
              ref={(el) => setSlotRef(index, el)}
              className={`dashboard__hostsWishSlot${isOpen ? ' is-open' : ''}${locked ? ' is-locked' : ''}`}
            >
              <button
                type="button"
                className={`dashboard__hostsWishSlotBox${picked ? ' has-picked' : ''}${isOpen ? ' is-active' : ''}`}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                aria-label={
                  picked
                    ? `${picked.title}, click to change`
                    : `Wish slot ${index + 1}, pick from game pool`
                }
                disabled={locked}
                onClick={() => toggleSlot(index)}
              >
                {picked && !isWishPoolNoneGame(picked) ? (
                  <GameCoverImage
                    gameId={picked.id}
                    title={picked.title}
                    className="gameCover--wishSlot"
                  />
                ) : null}
                {picked ? (
                  <span
                    className={`dashboard__hostsWishSlotLabel${isWishPoolNoneGame(picked) ? ' dashboard__hostsWishSlotLabel--none' : ''}`}
                    title={picked.title}
                  >
                    {picked.title}
                  </span>
                ) : (
                  <span className="dashboard__hostsWishSlotPlus" aria-hidden>
                    +
                  </span>
                )}
              </button>
            </div>
          )
        })}

        {activeSlot !== null && flyoutStyle && !locked ? (
          <div
            className="dashboard__hostsWishPicker dashboard__hostsWishPicker--side"
            role="listbox"
            aria-label="Game pool"
            style={{
              position: flyoutStyle.position,
              top: flyoutStyle.top,
              left: flyoutStyle.left,
              width: flyoutStyle.width,
              maxHeight: flyoutStyle.maxHeight,
              zIndex: flyoutStyle.zIndex,
            }}
          >
            {catalogLoading ? (
              <p className="dashboard__hostsWishPickerHint">Loading game pool…</p>
            ) : null}
            {catalogErr ? (
              <p className="dashboard__hostsWishPickerErr" role="alert">
                {catalogErr}
              </p>
            ) : null}
            {!catalogLoading && !catalogErr && catalog?.length === 0 ? (
              <p className="dashboard__hostsWishPickerHint">Game pool is empty</p>
            ) : null}
            <button
              type="button"
              role="option"
              className="dashboard__hostsWishPickRow dashboard__hostsWishPickRow--none"
              onClick={() => pickNone(activeSlot)}
            >
              None
            </button>
            {catalog?.map((g) => (
              <button
                key={g.id}
                type="button"
                role="option"
                className="dashboard__hostsWishPickRow dashboard__hostsWishPickRow--withCover"
                onClick={() => pickGame(activeSlot, g)}
              >
                <GameCoverImage
                  gameId={g.id}
                  title={g.title}
                  className="gameCover--pickerRow"
                />
                <span className="dashboard__hostsWishPickRowText">{g.title}</span>
              </button>
            ))}
          </div>
        ) : null}
        </div>

        {actionErr ? (
          <p className="dashboard__hostsWishPickerErr" role="alert">
            {actionErr}
          </p>
        ) : null}
      </div>

      <div className="dashboard__hostsWishActions">
        {locked ? (
          <button
            type="button"
            className="dashboard__hostsWishActionBtn dashboard__hostsWishActionBtn--secondary"
            onClick={handleCancelToEdit}
          >
            Cancel
          </button>
        ) : (
          <>
            <button
              type="button"
              className="dashboard__hostsWishActionBtn dashboard__hostsWishActionBtn--primary"
              disabled={!allFilled || saving}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="dashboard__hostsWishActionBtn dashboard__hostsWishActionBtn--secondary"
              disabled={saving}
              onClick={handleCancelRevert}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}
