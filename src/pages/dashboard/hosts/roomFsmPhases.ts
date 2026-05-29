export type RoomPhase =
  | 'LOBBY'
  | 'WISH_COLLECTION'
  | 'READY_LOCK'
  | 'SPINNING'
  | 'VETO_PHASE'
  | 'RESPINNING'
  | 'FINALIZED'
  | 'CLOSED'

export const ROOM_PHASE_LABEL: Record<RoomPhase, string> = {
  LOBBY: 'Lobby',
  WISH_COLLECTION: 'Wish collection',
  READY_LOCK: 'Ready lock',
  SPINNING: 'Spinning',
  VETO_PHASE: 'Veto vote',
  RESPINNING: 'Respinning',
  FINALIZED: 'Finalized',
  CLOSED: 'Closed',
}

export function phaseAllowsWishEdit(phase: RoomPhase | undefined): boolean {
  return phase === 'WISH_COLLECTION'
}

export function phaseAllowsHostSpin(phase: RoomPhase | undefined): boolean {
  return phase === 'READY_LOCK' || phase === 'RESPINNING'
}

export function phaseAllowsVetoVote(phase: RoomPhase | undefined): boolean {
  return phase === 'VETO_PHASE'
}
