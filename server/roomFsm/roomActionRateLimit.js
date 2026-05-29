/** @typedef {'ready' | 'spin' | 'veto' | 'start' | 'wishlist' | 'finalize' | 'close'} RoomActionKind */

const BUCKETS = new Map()

/** @type {Record<RoomActionKind, { windowMs: number, max: number }>} */
const LIMITS = {
  ready: { windowMs: 2000, max: 8 },
  spin: { windowMs: 5000, max: 3 },
  veto: { windowMs: 2000, max: 8 },
  start: { windowMs: 5000, max: 4 },
  wishlist: { windowMs: 2000, max: 12 },
  finalize: { windowMs: 3000, max: 4 },
  close: { windowMs: 5000, max: 3 },
}

const MAX_BUCKETS = 20_000

/**
 * @param {string} roomId
 * @param {string} userId
 * @param {RoomActionKind} action
 */
export function checkRoomActionRateLimit(roomId, userId, action) {
  if (process.env.CHAOS_DISABLE_RATE_LIMIT === '1') {
    return { ok: true }
  }
  const cfg = LIMITS[action]
  if (!cfg) return { ok: true }

  const key = `${roomId}:${userId}:${action}`
  const now = Date.now()
  let bucket = BUCKETS.get(key)
  if (!bucket || now - bucket.startMs > cfg.windowMs) {
    bucket = { startMs: now, count: 0 }
    BUCKETS.set(key, bucket)
  }

  bucket.count += 1

  if (BUCKETS.size > MAX_BUCKETS) {
    const cutoff = now - 60_000
    for (const [k, b] of BUCKETS) {
      if (b.startMs < cutoff) BUCKETS.delete(k)
    }
  }

  if (bucket.count > cfg.max) {
    return { ok: false, code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.' }
  }
  return { ok: true }
}

/** @param {string} type */
export function rateLimitKindForEventType(type) {
  switch (type) {
    case 'PLAYER_READY_TOGGLED':
      return 'ready'
    case 'SPIN_STARTED':
      return 'spin'
    case 'VETO_USED':
      return 'veto'
    case 'GAME_START_REQUESTED':
      return 'start'
    case 'WISHLIST_UPDATED':
      return 'wishlist'
    case 'GAME_FINALIZED':
    case 'VETO_RESULT_RESOLVED':
      return 'finalize'
    case 'ROOM_CLOSED':
      return 'close'
    default:
      return null
  }
}
