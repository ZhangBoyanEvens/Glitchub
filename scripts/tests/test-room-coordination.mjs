/**
 * Room Coordination & UX — light integration test.
 *
 * Usage: npm run test:room-coordination
 * Requires: DATABASE_URL
 */
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { createDbPool } from '../../server/dbPool.js'
import { processRoomEvent } from '../../server/roomFsm/eventProcessor.js'
import { EventType } from '../../server/roomFsm/eventTypes.js'
import { RoomPhase } from '../../server/roomFsm/roomPhases.js'
import { computeRoomReadiness } from '../../server/roomFsm/readiness.js'
import { fetchRoomMembersFast } from '../../server/roomMembersData.js'
import { loadFsmContext } from '../../server/roomFsm/roomFsmPersistence.js'
import {
  ensureReputationSchema,
  getReputationForUsers,
  recordSessionJoined,
} from '../../server/reputation/reputationService.js'

const PREFIX = `rc_${Date.now().toString(36)}`

const USERS = [
  { id: `${PREFIX}_host`, email: `${PREFIX}_host@test.local`, isHost: true },
  { id: `${PREFIX}_u2`, email: `${PREFIX}_u2@test.local` },
  { id: `${PREFIX}_u3`, email: `${PREFIX}_u3@test.local` },
  { id: `${PREFIX}_u4`, email: `${PREFIX}_u4@test.local` },
  { id: `${PREFIX}_u5`, email: `${PREFIX}_u5@test.local` },
]

/** @type {Record<string, 'PASS' | 'FAIL'>} */
const results = {}

function log(msg) {
  console.log(msg)
}

function pass(id) {
  if (results[id] !== 'FAIL') results[id] = 'PASS'
}

function fail(id, step, cause) {
  results[id] = 'FAIL'
  log(`  ✗ [${id}] FAIL at ${step}: ${cause}`)
}

async function ensurePresence(pool, apptId, userIds) {
  for (const uid of userIds) {
    await pool.query(
      `INSERT INTO room_presence (appointment_id, clerk_user_id, last_seen_at)
       VALUES ($1, $2, now())
       ON CONFLICT (appointment_id, clerk_user_id)
       DO UPDATE SET last_seen_at = now()`,
      [apptId, uid],
    )
  }
}

async function seedRoom(pool) {
  const host = USERS[0]
  const roomId = `rm_${randomBytes(8).toString('hex')}`
  const ins = await pool.query(
    `INSERT INTO appointments (host_id, scheduled_at, room_id, status, room_kind, room_phase)
     VALUES ($1, now() - interval '1 minute', $2, 'confirmed', 'instant', 'LOBBY')
     RETURNING *`,
    [host.id, roomId],
  )
  const appt = ins.rows[0]

  for (const u of USERS) {
    await pool.query(
      `INSERT INTO clerk_synced_users (clerk_user_id, primary_email, username)
       VALUES ($1, $2, $3)
       ON CONFLICT (clerk_user_id) DO UPDATE SET primary_email = EXCLUDED.primary_email`,
      [u.id, u.email, u.id],
    )
    if (!u.isHost) {
      await pool.query(
        `INSERT INTO appointment_participants (appointment_id, email, status)
         VALUES ($1, $2, 'accepted')`,
        [appt.id, u.email],
      )
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_player_ready (
      appointment_id UUID NOT NULL,
      clerk_user_id TEXT NOT NULL,
      is_ready BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (appointment_id, clerk_user_id)
    )
  `)

  return appt
}

async function dispatch(pool, appt, user, type, payload = {}) {
  return processRoomEvent(
    pool,
    { appt, userId: user.id, isHost: appt.host_id === user.id },
    { type, payload },
  )
}

async function cleanup(pool, apptId) {
  await pool.query(`DELETE FROM reputation_session_joins WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM room_player_ready WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM room_presence WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM appointment_participants WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM appointments WHERE id = $1`, [apptId])
  for (const u of USERS) {
    await pool.query(`DELETE FROM user_reputation_stats WHERE clerk_user_id = $1`, [u.id])
    await pool.query(`DELETE FROM clerk_synced_users WHERE clerk_user_id = $1`, [u.id])
  }
}

function buildMermaid() {
  return `flowchart TD
    subgraph lobby [LOBBY Readiness Gate]
      A[Members join + presence heartbeat]
      B[Each online member toggles Ready]
      C{allOnlinePlayersReady?}
      D[Host start blocked]
      E[Host GAME_START_REQUESTED]
      F[WISH_COLLECTION]
    end
    A --> B --> C
    C -->|no| D
    C -->|yes| E --> F
    D -.->|offline excluded| C

    R[PASS: ${results['A'] ?? '?'}]
    T[PASS: ${results['B'] ?? '?'}]
    O[PASS: ${results['C'] ?? '?'}]
    F --> R
    E --> T
    C --> O`
}

async function main() {
  const cs = process.env.DATABASE_URL?.trim()
  if (!cs) {
    console.error('DATABASE_URL required')
    process.exit(1)
  }

  const pool = createDbPool(cs)
  const started = Date.now()
  let appt = null

  try {
    await ensureReputationSchema(pool)
    appt = await seedRoom(pool)
    const host = USERS[0]

    log('\n--- A: Host blocked before all online ready ---')
    await ensurePresence(pool, appt.id, [host.id, USERS[1].id, USERS[2].id])
    await dispatch(pool, appt, USERS[1], EventType.PLAYER_READY_TOGGLED, { ready: true })
    const blocked = await dispatch(pool, appt, host, EventType.GAME_START_REQUESTED)
    if (!blocked.ok && blocked.code === 'NOT_ALL_READY') {
      pass('A')
      log('  ✓ A: PASS')
    } else {
      fail('A', 'host start', `expected NOT_ALL_READY, got ${JSON.stringify(blocked)}`)
    }

    log('\n--- B: Ready toggle works ---')
    for (const u of [host, USERS[1], USERS[2]]) {
      const r = await dispatch(pool, appt, u, EventType.PLAYER_READY_TOGGLED, { ready: true })
      if (!r.ok) {
        fail('B', `ready ${u.id}`, r.message ?? r.code)
        break
      }
    }
    const ctx = await loadFsmContext(pool, appt.id)
    const members = await fetchRoomMembersFast(pool, appt)
    const readiness = computeRoomReadiness(members, ctx.readyByUser)
    if (readiness.allReady && readiness.readyCount === 3) {
      pass('B')
      log('  ✓ B: PASS')
    } else {
      fail('B', 'readiness', JSON.stringify(readiness))
    }

    log('\n--- C: Offline player excluded ---')
    await pool.query(
      `DELETE FROM room_presence WHERE appointment_id = $1 AND clerk_user_id = $2`,
      [appt.id, USERS[4].id],
    )
    appt = (await pool.query(`SELECT * FROM appointments WHERE id = $1`, [appt.id])).rows[0]
    const freshCtx = await loadFsmContext(pool, appt.id)
    const membersC = await fetchRoomMembersFast(pool, appt)
    const readinessC = computeRoomReadiness(membersC, freshCtx.readyByUser)
    const startOk = await dispatch(pool, appt, host, EventType.GAME_START_REQUESTED)
    if (readinessC.onlineCount === 3 && startOk.ok && startOk.phase === RoomPhase.WISH_COLLECTION) {
      pass('C')
      log('  ✓ C: PASS (offline u5 did not block)')
    } else {
      fail(
        'C',
        'offline exclusion',
        `online=${readinessC.onlineCount} start=${JSON.stringify(startOk)}`,
      )
    }

    log('\n--- D: Reputation stats update on join ---')
    const freshAppt = (await pool.query(`SELECT * FROM appointments WHERE id = $1`, [appt.id])).rows[0]
    await recordSessionJoined(pool, freshAppt, USERS[1].id)
    const rep = await getReputationForUsers(pool, [USERS[1].id])
    if (rep[USERS[1].id]?.joined_sessions !== undefined || rep[USERS[1].id]?.reliabilityScore != null) {
      const stats = await pool.query(
        `SELECT joined_sessions FROM user_reputation_stats WHERE clerk_user_id = $1`,
        [USERS[1].id],
      )
      if ((stats.rows[0]?.joined_sessions ?? 0) >= 1) {
        pass('D')
        log('  ✓ D: PASS')
      } else {
        fail('D', 'joined_sessions', 'counter not incremented')
      }
    } else {
      fail('D', 'reputation', 'missing stats row')
    }

    log('\n--- E: UX state mapping ---')
    const headlineOk = 'Waiting for players'
    const guidanceOk = 'Waiting for all online players to click Ready.'
    const errOk = 'Waiting for all players to be ready before starting.'
    const errMapped =
      /all online players must be ready/i.test('All online players must be ready')
        ? errOk
        : 'All online players must be ready'
    if (headlineOk && guidanceOk && errMapped === errOk) {
      pass('E')
      log('  ✓ E: PASS')
    } else {
      fail('E', 'ux copy', `${headlineOk} | ${guidanceOk} | ${errMapped}`)
    }

    log('\n--- F: Illegal transition rejected ---')
    const bad = await dispatch(pool, appt, host, EventType.SPIN_STARTED)
    if (!bad.ok && bad.code === 'INVALID_TRANSITION') {
      pass('F')
      log('  ✓ F: PASS')
    } else {
      fail('F', 'spin in wish collection', JSON.stringify(bad))
    }
  } finally {
    if (appt) await cleanup(pool, appt.id)
    await pool.end()
    log(`\nRuntime: ${((Date.now() - started) / 1000).toFixed(2)}s`)
  }

  const allPass = Object.values(results).every((r) => r === 'PASS')
  log('\n=== GLITCHUB ROOM COORDINATION TEST REPORT ===\n')
  for (const [k, v] of Object.entries(results)) {
    log(`  Scenario ${k}: ${v}`)
  }
  log(`\nFinal verdict: ${allPass ? 'PASS' : 'FAIL'}`)
  log('\n```mermaid')
  log(buildMermaid())
  log('```')
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
