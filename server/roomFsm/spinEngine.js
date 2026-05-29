import { randomBytes, randomUUID } from 'node:crypto'
import { pickSpinResult } from '../spinPick.js'

const DEFAULT_SPIN_DURATION_MS = Number(process.env.ROOM_SPIN_DURATION_MS ?? 3500)

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 * @param {number} round
 */
export async function createAuthoritativeSpin(pool, appointmentId, round) {
  const spinDuration = DEFAULT_SPIN_DURATION_MS
  const serverTimestamp = Date.now()
  const revealTimestamp = serverTimestamp + spinDuration
  const spinId = randomUUID()
  const seed = randomBytes(4).readUInt32BE(0)
  const result = await pickSpinResult(pool, appointmentId, seed)

  return {
    spinId,
    seed,
    round,
    resultGameId: result.id,
    resultGameTitle: result.title,
    tierRank: result.tier_rank,
    spinDuration,
    serverTimestamp,
    revealTimestamp,
  }
}

/**
 * @param {object} spin
 */
export function spinToWsPayload(spin) {
  return {
    eventType: 'ROOM_SPIN_START',
    spinId: spin.spinId,
    roomId: spin.roomId,
    seed: spin.seed,
    resultGameId: spin.resultGameId,
    resultGameTitle: spin.resultGameTitle,
    tierRank: spin.tierRank,
    serverTimestamp: spin.serverTimestamp,
    spinDuration: spin.spinDuration,
    revealTimestamp: spin.revealTimestamp,
    round: spin.round,
  }
}

/**
 * @param {import('pg').QueryResultRow} row
 */
export function spinRowToWsPayload(row) {
  return {
    eventType: 'ROOM_SPIN_START',
    spinId: row.spin_id,
    roomId: row.room_id,
    seed: Number(row.seed),
    resultGameId: Number(row.result_game_id),
    resultGameTitle: row.result_game_title,
    tierRank: Number(row.tier_rank),
    serverTimestamp: Number(row.server_timestamp_ms),
    spinDuration: Number(row.spin_duration_ms),
    revealTimestamp: Number(row.reveal_timestamp_ms),
    round: Number(row.round_number ?? 0),
  }
}

export { DEFAULT_SPIN_DURATION_MS }
