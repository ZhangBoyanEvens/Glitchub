export type RoomSpinStartEvent = {
  eventType: 'ROOM_SPIN_START'
  spinId: string
  roomId: string
  seed: number
  resultGameId: number
  resultGameTitle: string
  tierRank: number
  serverTimestamp: number
  spinDuration: number
  revealTimestamp: number
}

export type SpinSyncPhase = 'idle' | 'syncing' | 'spinning' | 'revealed'
