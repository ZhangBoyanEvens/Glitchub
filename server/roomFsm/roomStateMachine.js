import { RoomPhase } from './roomPhases.js'
import { EventType } from './eventTypes.js'

/**
 * 纯 FSM：仅根据当前 phase 与事件类型决定下一 phase。
 * 副作用（写库、抽奖）由 eventProcessor 在 transition 返回 ok 后执行。
 *
 * @param {string} phase
 * @param {{ type: string, payload?: Record<string, unknown> }} event
 * @returns {{ ok: true, phase: string } | { ok: false, code: string, message: string }}
 */
export function transition(phase, event) {
  const type = event.type
  const payload = event.payload ?? {}

  switch (phase) {
    case RoomPhase.LOBBY:
      if (type === EventType.PLAYER_READY_TOGGLED) {
        return { ok: true, phase: RoomPhase.LOBBY }
      }
      if (type === EventType.GAME_START_REQUESTED && payload.allPlayersReady === true) {
        return { ok: true, phase: RoomPhase.WISH_COLLECTION }
      }
      break

    case RoomPhase.WISH_COLLECTION:
      if (type === EventType.WISHLIST_UPDATED) {
        return { ok: true, phase: RoomPhase.WISH_COLLECTION }
      }
      if (type === EventType.PLAYER_READY_TOGGLED) {
        return { ok: true, phase: RoomPhase.WISH_COLLECTION }
      }
      if (type === EventType.GAME_START_REQUESTED && payload.forceReadyLock === true) {
        return { ok: true, phase: RoomPhase.READY_LOCK }
      }
      if (type === EventType.GAME_START_REQUESTED && payload.allPlayersReady === true) {
        return { ok: true, phase: RoomPhase.READY_LOCK }
      }
      break

    case RoomPhase.READY_LOCK:
      if (type === EventType.SPIN_STARTED) {
        return { ok: true, phase: RoomPhase.SPINNING }
      }
      break

    case RoomPhase.SPINNING:
      if (type === EventType.SPIN_REVEALED) {
        return { ok: true, phase: RoomPhase.VETO_PHASE }
      }
      break

    case RoomPhase.VETO_PHASE:
      if (type === EventType.VETO_USED) {
        return { ok: true, phase: RoomPhase.VETO_PHASE }
      }
      if (type === EventType.VETO_RESULT_RESOLVED) {
        if (payload.outcome === 'finalized') {
          return { ok: true, phase: RoomPhase.FINALIZED }
        }
        if (payload.outcome === 'respun') {
          return { ok: true, phase: RoomPhase.RESPINNING }
        }
      }
      if (type === EventType.GAME_FINALIZED) {
        return { ok: true, phase: RoomPhase.FINALIZED }
      }
      break

    case RoomPhase.RESPINNING:
      if (type === EventType.SPIN_STARTED) {
        return { ok: true, phase: RoomPhase.SPINNING }
      }
      break

    case RoomPhase.FINALIZED:
      if (type === EventType.ROOM_CLOSED) {
        return { ok: true, phase: RoomPhase.CLOSED }
      }
      break

    case RoomPhase.CLOSED:
      break

    default:
      break
  }

  return {
    ok: false,
    code: 'INVALID_TRANSITION',
    message: `Cannot apply ${type} in phase ${phase}`,
  }
}

/**
 * @param {string} phase
 * @param {string} eventType
 */
export function canMutateWishlist(phase, eventType) {
  if (eventType === EventType.WISHLIST_UPDATED) {
    return phase === RoomPhase.WISH_COLLECTION
  }
  return phase === RoomPhase.WISH_COLLECTION
}

/**
 * @param {string} phase
 */
export function canToggleReady(phase) {
  return phase === RoomPhase.LOBBY || phase === RoomPhase.WISH_COLLECTION
}

/**
 * @param {string} phase
 */
export function canHostSpin(phase) {
  return phase === RoomPhase.READY_LOCK || phase === RoomPhase.RESPINNING
}

/**
 * @param {string} phase
 */
export function canUseVeto(phase) {
  return phase === RoomPhase.VETO_PHASE
}
