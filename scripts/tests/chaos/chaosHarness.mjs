import { randomBytes, randomUUID } from 'node:crypto'
import { processRoomEvent, syncFsmOnRead } from '../../../server/roomFsm/eventProcessor.js'
import { EventType } from '../../../server/roomFsm/eventTypes.js'
import { loadFsmContext } from '../../../server/roomFsm/roomFsmPersistence.js'
import { ALL_PHASES, RoomPhase } from '../../../server/roomFsm/roomPhases.js'

/** FSM 合法阶段顺序（用于检测跳阶段） */
export const PHASE_RANK = {
  [RoomPhase.LOBBY]: 0,
  [RoomPhase.WISH_COLLECTION]: 1,
  [RoomPhase.READY_LOCK]: 2,
  [RoomPhase.SPINNING]: 3,
  [RoomPhase.VETO_PHASE]: 4,
  [RoomPhase.RESPINNING]: 5,
  [RoomPhase.FINALIZED]: 6,
  [RoomPhase.CLOSED]: 7,
}

/**
 * @param {number} seed
 */
export function createRng(seed) {
  let s = seed >>> 0
  return () => {
    s += 0x6d2b79f5
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param {() => number} rng
 * @param {number} minMs
 * @param {number} maxMs
 */
export function randomLatency(rng, minMs, maxMs) {
  const lo = minMs ?? (process.env.CHAOS_FAST === '1' ? 0 : 50)
  const hi = maxMs ?? (process.env.CHAOS_FAST === '1' ? 15 : 300)
  return lo + Math.floor(rng() * (hi - lo + 1))
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} prefix
 * @param {number} userCount
 */
export async function seedChaosRoom(pool, prefix, userCount) {
  const hostId = `${prefix}_host`
  const roomId = `rm_${randomBytes(8).toString('hex')}`

  const ins = await pool.query(
    `INSERT INTO appointments (
       host_id, scheduled_at, room_id, status, room_kind, room_phase
     )
     VALUES ($1, now() - interval '1 minute', $2, 'confirmed', 'instant', 'LOBBY')
     RETURNING *`,
    [hostId, roomId],
  )
  const appt = ins.rows[0]

  /** @type {{ id: string, email: string, isHost: boolean }[]} */
  const users = []
  for (let i = 0; i < userCount; i++) {
    const isHost = i === 0
    const id = isHost ? hostId : `${prefix}_u${i}`
    const email = `${id}@chaos.test`
    users.push({ id, email, isHost })
    await pool.query(
      `INSERT INTO clerk_synced_users (clerk_user_id, primary_email, username, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (clerk_user_id) DO UPDATE SET primary_email = EXCLUDED.primary_email`,
      [id, email, `chaos_${i}`],
    )
    if (!isHost) {
      await pool.query(
        `INSERT INTO appointment_participants (appointment_id, email, status)
         VALUES ($1, $2, 'accepted')`,
        [appt.id, email],
      )
    }
  }

  const games = await pool.query(`SELECT id FROM reference_games ORDER BY id LIMIT 3`)
  const gameIds =
    games.rows.length >= 3
      ? games.rows.map((r) => r.id)
      : [games.rows[0]?.id ?? 1, games.rows[0]?.id ?? 1, 0]

  return { appt, users, gameIds, host: users[0] }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 * @param {string[]} userIds
 */
export async function ensureAllPresence(pool, appointmentId, userIds) {
  for (const uid of userIds) {
    await pool.query(
      `INSERT INTO room_presence (appointment_id, clerk_user_id, last_seen_at)
       VALUES ($1, $2, now())
       ON CONFLICT (appointment_id, clerk_user_id)
       DO UPDATE SET last_seen_at = now()`,
      [appointmentId, uid],
    )
  }
}

/**
 * LOBBY → WISH_COLLECTION with readiness gate satisfied.
 *
 * @param {import('pg').Pool} pool
 * @param {import('pg').QueryResultRow} appt
 * @param {{ id: string, isHost?: boolean }[]} users
 */
export async function lobbyReadyAndStart(pool, appt, users) {
  const userIds = users.map((u) => u.id)
  await ensureAllPresence(pool, appt.id, userIds)
  for (const u of users) {
    await dispatch(pool, appt, u, EventType.PLAYER_READY_TOGGLED, { ready: true })
  }
  const host = users.find((u) => u.isHost) ?? users[0]
  return dispatch(pool, appt, host, EventType.GAME_START_REQUESTED)
}

export async function fastForwardSpinReveal(pool, appointmentId) {
  await pool.query(
    `UPDATE room_spins
     SET server_timestamp_ms = $2, reveal_timestamp_ms = $3
     WHERE appointment_id = $1 AND invalidated_at IS NULL`,
    [appointmentId, Date.now() - 10_000, Date.now() - 500],
  )
  const appt = await pool.query(`SELECT * FROM appointments WHERE id = $1`, [appointmentId])
  if (appt.rows[0]) await syncFsmOnRead(pool, appt.rows[0])
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} appointmentId
 */
export async function captureSnapshot(pool, appointmentId) {
  const ctx = await loadFsmContext(pool, appointmentId)
  if (!ctx) return null

  const activeQ = await pool.query(
    `SELECT COUNT(*)::int AS n FROM room_spins
     WHERE appointment_id = $1 AND invalidated_at IS NULL`,
    [appointmentId],
  )
  const totalSpinsQ = await pool.query(
    `SELECT COUNT(*)::int AS n FROM room_spins WHERE appointment_id = $1`,
    [appointmentId],
  )
  const eventsQ = await pool.query(
    `SELECT COUNT(*)::int AS n FROM room_events WHERE appointment_id = $1`,
    [appointmentId],
  )

  return {
    phase: ctx.phase,
    round: ctx.round,
    finalGameId: ctx.appt.final_game_id ?? null,
    finalGameTitle: ctx.appt.final_game_title ?? null,
    activeSpinId: ctx.activeSpin?.spin_id ?? null,
    activeSpinTitle: ctx.activeSpin?.result_game_title ?? null,
    activeSpinCount: activeQ.rows[0]?.n ?? 0,
    totalSpinCount: totalSpinsQ.rows[0]?.n ?? 0,
    eventLogCount: eventsQ.rows[0]?.n ?? 0,
    status: ctx.appt.status,
  }
}

export function snapshotKey(s) {
  if (!s) return ''
  return JSON.stringify({
    phase: s.phase,
    round: s.round,
    finalGameId: s.finalGameId,
    finalGameTitle: s.finalGameTitle,
    activeSpinId: s.activeSpinId,
    activeSpinCount: s.activeSpinCount,
  })
}

export class ChaosMetrics {
  constructor(seed) {
    this.seed = seed
    this.totalEvents = 0
    this.acceptedEvents = 0
    this.invalidTransitions = 0
    this.duplicatesIgnored = 0
    this.raceConditionsDetected = 0
    this.droppedEvents = 0
    this.criticalFailures = []
    this.phaseHistory = []
    this.concurrentSpinSuccesses = 0
    this.replayMatch = null
    this.finalConsistency = null
    this.categories = {}
  }

  /**
   * @param {string} category
   * @param {boolean} pass
   */
  setCategory(category, pass) {
    this.categories[category] = pass
  }

  /**
   * @param {string} code
   */
  failCritical(code, detail = '') {
    this.criticalFailures.push(detail ? `${code}: ${detail}` : code)
  }

  /**
   * @param {Awaited<ReturnType<typeof captureSnapshot>>} before
   * @param {Awaited<ReturnType<typeof captureSnapshot>>} after
   * @param {{ ok?: boolean, code?: string }} result
   */
  recordEvent(before, after, result) {
    this.totalEvents++
    if (result?.ok) {
      this.acceptedEvents++
      if (before && after && snapshotKey(before) === snapshotKey(after)) {
        this.duplicatesIgnored++
      }
    } else if (result?.code === 'INVALID_TRANSITION' || result?.code === 'ROOM_CLOSED' || result?.code === 'DUPLICATE_EVENT') {
      this.invalidTransitions++
    }
    if (after?.phase) {
      const prev = this.phaseHistory[this.phaseHistory.length - 1]
      if (prev !== after.phase) {
        const prevRank = PHASE_RANK[prev] ?? -1
        const nextRank = PHASE_RANK[after.phase] ?? -1
        const skipDetect =
          prev != null &&
          prevRank >= 0 &&
          nextRank > prevRank + 1 &&
          after.phase !== RoomPhase.RESPINNING &&
          !(prev === RoomPhase.READY_LOCK && after.phase === RoomPhase.VETO_PHASE)
        if (skipDetect) {
          this.failCritical('PHASE_SKIP', `${prev} → ${after.phase}`)
        }
        this.phaseHistory.push(after.phase)
      }
    }
  }

  /**
   * @param {import('pg').Pool} pool
   * @param {string} appointmentId
   */
  async assertInvariants(pool, appointmentId, label = '') {
    const snap = await captureSnapshot(pool, appointmentId)
    if (!snap) {
      this.failCritical('NO_SNAPSHOT', label)
      return snap
    }

    if (!ALL_PHASES.has(snap.phase)) {
      this.failCritical('UNDEFINED_PHASE', snap.phase)
    }

    if (snap.activeSpinCount > 1) {
      this.failCritical('MULTIPLE_ACTIVE_SPINS', `count=${snap.activeSpinCount}`)
    }

    if (snap.phase === RoomPhase.SPINNING && snap.activeSpinCount === 0) {
      this.failCritical('SPINNING_WITHOUT_ACTIVE_SPIN', label)
    }

    if (snap.phase === RoomPhase.VETO_PHASE && snap.activeSpinCount === 0) {
      this.failCritical('VETO_WITHOUT_ACTIVE_SPIN', label)
    }

    return snap
  }

  printReport() {
    console.log('\n╔══════════════════════════════════════════════════╗')
    console.log('║       Glitchub FSM Chaos / Stress Report         ║')
    console.log('╚══════════════════════════════════════════════════╝')
    console.log(`  Seed (reproducible):     ${this.seed}`)
    console.log(`  Total events processed:  ${this.totalEvents}`)
    console.log(`  Accepted (ok):           ${this.acceptedEvents}`)
    console.log(`  Invalid transitions:     ${this.invalidTransitions}`)
    console.log(`  Duplicates / no-op:      ${this.duplicatesIgnored}`)
    console.log(`  Race conditions flagged: ${this.raceConditionsDetected}`)
    console.log(`  Dropped events (sim):    ${this.droppedEvents}`)
    console.log(`  Concurrent spin wins:    ${this.concurrentSpinSuccesses}`)
    console.log('')
    console.log('  Category results:')
    for (const [k, v] of Object.entries(this.categories)) {
      console.log(`    ${v ? 'PASS' : 'FAIL'}  ${k}`)
    }
    console.log('')
    console.log(
      `  Final state consistency: ${this.finalConsistency === true ? 'PASS' : this.finalConsistency === false ? 'FAIL' : 'N/A'}`,
    )
    console.log(
      `  Replay consistency:      ${this.replayMatch === true ? 'PASS' : this.replayMatch === false ? 'FAIL' : 'N/A'}`,
    )
    if (this.criticalFailures.length) {
      console.log('\n  Critical failures:')
      for (const f of this.criticalFailures) console.log(`    ✗ ${f}`)
    } else {
      console.log('\n  No critical failures.')
    }
    console.log('')
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {import('pg').QueryResultRow} appt
 * @param {{ id: string, isHost: boolean }} user
 * @param {string} type
 * @param {Record<string, unknown>} [payload]
 * @param {{ eventId?: string, timestamp?: number }} [meta]
 */
export async function dispatch(pool, appt, user, type, payload = {}, meta = {}) {
  return processRoomEvent(
    pool,
    { appt, userId: user.id, isHost: user.isHost || appt.host_id === user.id },
    { type, payload, ...meta },
  )
}

/**
 * 乱序投递：随机延迟后按 shuffle 顺序执行
 * @param {Array<() => Promise<unknown>>} tasks
 * @param {() => number} rng
 * @param {{ dropRate?: number }} opts
 */
export async function deliverShuffled(tasks, rng, opts = {}) {
  const dropRate = opts.dropRate ?? 0
  const indexed = tasks.map((fn, i) => ({ fn, i, drop: rng() < dropRate }))
  const dropped = indexed.filter((x) => x.drop).length
  const run = indexed.filter((x) => !x.drop)
  for (let k = run.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1))
    ;[run[k], run[j]] = [run[j], run[k]]
  }
  for (const item of run) {
    await sleep(randomLatency(rng))
    await item.fn()
  }
  return { dropped, delivered: run.length }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} prefix
 * @param {string[]} userIds
 */
export async function cleanupChaosRoom(pool, appointmentId, userIds) {
  const exists = await pool.query(`SELECT 1 FROM appointments WHERE id = $1`, [appointmentId])
  if (!exists.rows.length) {
    for (const uid of userIds) {
      await pool.query(`DELETE FROM clerk_synced_users WHERE clerk_user_id = $1`, [uid])
    }
    return
  }
  const tables = [
    'room_events',
    'room_spins',
    'room_game_votes',
    'room_game_vetoes',
    'room_wish_pool',
    'room_player_ready',
    'room_presence',
    'room_case_draw_logs',
    'appointment_participants',
  ]
  for (const t of tables) {
    await pool.query(`DELETE FROM ${t} WHERE appointment_id = $1`, [appointmentId]).catch(() => {})
  }
  await pool.query(`DELETE FROM appointments WHERE id = $1`, [appointmentId])
  for (const uid of userIds) {
    await pool.query(`DELETE FROM clerk_synced_users WHERE clerk_user_id = $1`, [uid])
  }
}

export { EventType, RoomPhase, randomUUID }
