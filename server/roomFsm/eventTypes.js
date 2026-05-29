/** @readonly */
export const EventType = {
  PLAYER_JOINED: 'PLAYER_JOINED',
  WISHLIST_UPDATED: 'WISHLIST_UPDATED',
  PLAYER_READY_TOGGLED: 'PLAYER_READY_TOGGLED',
  GAME_START_REQUESTED: 'GAME_START_REQUESTED',
  SPIN_STARTED: 'SPIN_STARTED',
  VETO_USED: 'VETO_USED',
  VETO_RESULT_RESOLVED: 'VETO_RESULT_RESOLVED',
  GAME_FINALIZED: 'GAME_FINALIZED',
  ROOM_CLOSED: 'ROOM_CLOSED',
  /** 内部：转盘动画结束，SPINNING → VETO_PHASE */
  SPIN_REVEALED: 'SPIN_REVEALED',
}

/**
 * @param {object} input
 * @returns {{
 *   eventId: string,
 *   type: string,
 *   roomId: string,
 *   timestamp: number,
 *   userId: string,
 *   payload: Record<string, unknown>
 * }}
 */
export function buildDomainEvent(input) {
  return {
    eventId: input.eventId,
    type: input.type,
    roomId: input.roomId,
    timestamp: input.timestamp ?? Date.now(),
    userId: input.userId,
    payload: input.payload ?? {},
  }
}
