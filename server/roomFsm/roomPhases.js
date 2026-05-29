/** @readonly */
export const RoomPhase = {
  LOBBY: 'LOBBY',
  WISH_COLLECTION: 'WISH_COLLECTION',
  READY_LOCK: 'READY_LOCK',
  SPINNING: 'SPINNING',
  VETO_PHASE: 'VETO_PHASE',
  RESPINNING: 'RESPINNING',
  FINALIZED: 'FINALIZED',
  CLOSED: 'CLOSED',
}

/** @type {Set<string>} */
export const ALL_PHASES = new Set(Object.values(RoomPhase))

/**
 * @param {string | null | undefined} raw
 */
export function normalizePhase(raw) {
  const p = String(raw ?? '').trim().toUpperCase()
  return ALL_PHASES.has(p) ? p : RoomPhase.LOBBY
}

/**
 * 兼容旧数据：有 game_started_at 但无 room_phase 时视为许愿收集阶段。
 *
 * @param {{ room_phase?: string | null, game_started_at?: Date | string | null, status?: string }} appt
 */
export function resolvePhaseFromAppointment(appt) {
  if (appt.status === 'cancelled') return RoomPhase.CLOSED
  const stored = appt.room_phase?.trim()
  if (stored && ALL_PHASES.has(stored.toUpperCase())) {
    return stored.toUpperCase()
  }
  if (appt.game_started_at) return RoomPhase.WISH_COLLECTION
  return RoomPhase.LOBBY
}
