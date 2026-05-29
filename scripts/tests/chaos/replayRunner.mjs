import { processRoomEvent, syncFsmOnRead } from '../../../server/roomFsm/eventProcessor.js'
import { EventType } from '../../../server/roomFsm/eventTypes.js'
import { randomUUID } from 'node:crypto'
import {
  captureSnapshot,
  cleanupChaosRoom,
  ensureAllPresence,
  fastForwardSpinReveal,
  seedChaosRoom,
  snapshotKey,
} from './chaosHarness.mjs'

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 */
export async function fetchEventLog(pool, appointmentId) {
  const q = await pool.query(
    `SELECT event_id, event_type, clerk_user_id, payload, created_at
     FROM room_events
     WHERE appointment_id = $1
     ORDER BY created_at ASC, event_id ASC`,
    [appointmentId],
  )
  return q.rows.map((r) => ({
    eventId: r.event_id,
    type: r.event_type,
    userId: r.clerk_user_id,
    payload: typeof r.payload === 'object' ? r.payload : JSON.parse(String(r.payload ?? '{}')),
    createdAt: r.created_at,
  }))
}

/**
 * 用与 live 相同的 userId 前缀在新房间上重放事件
 *
 * @param {import('pg').Pool} pool
 * @param {string} prefix
 * @param {number} userCount
 * @param {Awaited<ReturnType<fetchEventLog>>} events
 */
/**
 * @param {import('pg').QueryResultRow[]} [recordedSpins]  live 端 room_spins 行（按时间序）
 */
export async function replayOnFreshRoom(pool, prefix, userCount, events, recordedSpins = []) {
  const { appt, users } = await seedChaosRoom(pool, prefix, userCount)
  const userById = new Map(users.map((u) => [u.id, u]))
  let spinReplayIdx = 0

  const replayTypes = new Set([
    EventType.GAME_START_REQUESTED,
    EventType.WISHLIST_UPDATED,
    EventType.PLAYER_READY_TOGGLED,
    EventType.SPIN_STARTED,
    EventType.VETO_USED,
    EventType.GAME_FINALIZED,
    EventType.ROOM_CLOSED,
    EventType.SPIN_REVEALED,
  ])

  for (const ev of events) {
    if (!replayTypes.has(ev.type)) continue
    const user = userById.get(ev.userId)
    if (!user) continue

    await ensureAllPresence(
      pool,
      appt.id,
      users.map((u) => u.id),
    )

    const freshAppt = (await pool.query(`SELECT * FROM appointments WHERE id = $1`, [appt.id]))
      .rows[0]

    if (ev.type === EventType.SPIN_STARTED && recordedSpins[spinReplayIdx]) {
      const row = recordedSpins[spinReplayIdx]
      spinReplayIdx++
      const tr = { ok: true, phase: 'SPINNING' }
      await pool.query(
        `INSERT INTO room_spins (
           spin_id, appointment_id, room_id, host_clerk_user_id,
           seed, result_game_id, result_game_title, tier_rank,
           spin_duration_ms, server_timestamp_ms, reveal_timestamp_ms, round_number
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          row.spin_id,
          appt.id,
          freshAppt.room_id,
          row.host_clerk_user_id,
          row.seed,
          row.result_game_id,
          row.result_game_title,
          row.tier_rank,
          row.spin_duration_ms,
          row.server_timestamp_ms,
          row.reveal_timestamp_ms,
          row.round_number ?? 0,
        ],
      )
      await pool.query(
        `UPDATE appointments
         SET room_phase = $2, room_round = $3, active_spin_id = $1, updated_at = now()
         WHERE id = $4`,
        [row.spin_id, tr.phase, row.round_number ?? 0, appt.id],
      )
      await fastForwardSpinReveal(pool, appt.id)
      await syncFsmOnRead(pool, freshAppt)
    } else {
      await processRoomEvent(
        pool,
        {
          appt: freshAppt,
          userId: user.id,
          isHost: freshAppt.host_id === user.id,
        },
        {
          type: ev.type,
          payload: ev.payload ?? {},
          eventId: randomUUID(),
          timestamp: Date.now(),
        },
      )

      if (ev.type === EventType.SPIN_STARTED) {
        await fastForwardSpinReveal(pool, appt.id)
        await syncFsmOnRead(pool, freshAppt)
      }
    }
  }

  const snap = await captureSnapshot(pool, appt.id)
  return { appt, users, snapshot: snap }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} sourceAppointmentId
 * @param {string} prefix
 * @param {number} userCount
 * @param {string[]} userIds
 */
export async function compareLiveVsReplay(pool, sourceAppointmentId, prefix, userCount, userIds) {
  const live = await captureSnapshot(pool, sourceAppointmentId)
  const events = await fetchEventLog(pool, sourceAppointmentId)
  const spinsQ = await pool.query(
    `SELECT * FROM room_spins WHERE appointment_id = $1 ORDER BY server_timestamp_ms ASC`,
    [sourceAppointmentId],
  )

  await cleanupChaosRoom(pool, sourceAppointmentId, userIds)

  const { snapshot: replayed, appt: replayAppt } = await replayOnFreshRoom(
    pool,
    prefix,
    userCount,
    events,
    spinsQ.rows,
  )

  const match =
    live &&
    replayed &&
    live.phase === replayed.phase &&
    live.round === replayed.round &&
    live.finalGameId === replayed.finalGameId &&
    live.finalGameTitle === replayed.finalGameTitle &&
    live.activeSpinCount === replayed.activeSpinCount &&
    live.activeSpinId === replayed.activeSpinId

  await cleanupChaosRoom(pool, replayAppt.id, userIds)

  return {
    match,
    live,
    replayed,
    eventCount: events.length,
    liveKey: snapshotKey(live),
    replayKey: snapshotKey(replayed),
  }
}

