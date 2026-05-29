import type { RoomPhase } from './roomFsmPhases.ts'

export const PHASE_STATUS_HEADLINE: Record<RoomPhase, string> = {
  LOBBY: 'Waiting for players',
  WISH_COLLECTION: 'Choose 3 games and click Ready',
  READY_LOCK: 'Waiting for all players to prepare',
  SPINNING: 'Rolling game selection…',
  VETO_PHASE: 'Vote approve or veto',
  RESPINNING: 'Re-rolling game selection…',
  FINALIZED: 'Game selected',
  CLOSED: 'Room ended',
}

export function phaseActionGuidance(
  phase: RoomPhase,
  opts: {
    isHost: boolean
    selfReady: boolean
    allReady: boolean
    wishPoolSaved: boolean
    hasVoted: boolean
  },
): string {
  switch (phase) {
    case 'LOBBY':
      if (opts.isHost) {
        return opts.allReady
          ? 'All online players are ready — you can start the game.'
          : 'Waiting for all online players to click Ready.'
      }
      return opts.selfReady
        ? 'Waiting for the host to start.'
        : 'Click Ready when you are set to play.'
    case 'WISH_COLLECTION':
      if (!opts.wishPoolSaved) return 'You still need to submit your wish pool.'
      return opts.selfReady ? 'Waiting for other players to ready up.' : 'Click Ready when your picks are set.'
    case 'READY_LOCK':
      return opts.isHost ? 'Start the spin when everyone is set.' : 'Waiting for the host to spin.'
    case 'VETO_PHASE':
      return opts.hasVoted ? 'Waiting for other votes.' : 'Please vote to continue.'
    case 'FINALIZED':
      return 'Room finalized — enjoy the pick!'
    case 'CLOSED':
      return 'This room has ended.'
    default:
      return PHASE_STATUS_HEADLINE[phase]
  }
}

export function mapRoomActionError(message: string, code?: string): string {
  const m = message.trim()
  const c = code?.trim() ?? ''

  if (c === 'NOT_ALL_READY' || /all online players must be ready/i.test(m)) {
    return 'Waiting for all players to be ready before starting.'
  }
  if (c === 'INVALID_TRANSITION' || /cannot apply/i.test(m)) {
    return 'Room is not in a valid state for this action.'
  }
  if (c === 'FORBIDDEN' && /host/i.test(m)) {
    return 'Only the host can perform this action.'
  }
  if (c === 'GAME_START_TOO_EARLY') {
    return 'The scheduled start time has not arrived yet.'
  }
  if (c === 'RATE_LIMITED' || /too many requests/i.test(m)) {
    return 'Too many actions. Please wait a moment and try again.'
  }
  if (c === 'SPIN_ALREADY_ACTIVE') {
    return 'A spin is already in progress.'
  }
  if (c === 'VETO_LIMIT_REACHED') {
    return 'You have used all available vetoes for this room.'
  }
  return m || 'Something went wrong. Please try again.'
}
