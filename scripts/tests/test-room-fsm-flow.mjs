/**
 * 五虚拟用户 · 预约房 FSM 全流程冒烟
 *
 * 流程：LOBBY → 开始 → 许愿/准备 → READY_LOCK → 抽奖 → 否决(1人反对→重抽) → 全员赞成 → FINALIZED → CLOSED
 *
 * 默认直连 eventProcessor（无需启动 HTTP）；设 FSM_TEST_HTTP=1 且 server:dev 运行时可额外走 REST。
 *
 * 用法：npm run test:room-fsm-flow
 * 需要：DATABASE_URL、reference_games 目录已 seed
 */
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { processRoomEvent, syncFsmOnRead } from '../../server/roomFsm/eventProcessor.js'
import { EventType } from '../../server/roomFsm/eventTypes.js'
import { loadFsmContext } from '../../server/roomFsm/roomFsmPersistence.js'
import { RoomPhase } from '../../server/roomFsm/roomPhases.js'

const PREFIX = `fsm5_${Date.now().toString(36)}`
const API_BASE = process.env.API_TEST_BASE?.replace(/\/$/, '') || 'http://127.0.0.1:8787'
const USE_HTTP = process.env.FSM_TEST_HTTP === '1'

/** @type {{ id: string, email: string, label: string, isHost?: boolean }[]} */
const VIRTUAL_USERS = [
  { id: `${PREFIX}_host`, email: `${PREFIX}_host@test.local`, label: '用户1(房主)', isHost: true },
  { id: `${PREFIX}_u2`, email: `${PREFIX}_u2@test.local`, label: '用户2' },
  { id: `${PREFIX}_u3`, email: `${PREFIX}_u3@test.local`, label: '用户3' },
  { id: `${PREFIX}_u4`, email: `${PREFIX}_u4@test.local`, label: '用户4' },
  { id: `${PREFIX}_u5`, email: `${PREFIX}_u5@test.local`, label: '用户5' },
]

/** @type {{ step: number, action: string, phase: string, detail?: string, ok: boolean }[]} */
const journal = []

function log(msg) {
  console.log(msg)
}

function record(step, action, phase, ok, detail = '') {
  journal.push({ step, action, phase, detail, ok })
  const mark = ok ? '✓' : '✗'
  log(`  ${mark} [${step}] ${action} → phase=${phase}${detail ? ` | ${detail}` : ''}`)
}

async function loadPhase(pool, apptId) {
  const ctx = await loadFsmContext(pool, apptId)
  return ctx?.phase ?? '?'
}

async function loadSnapshot(pool, apptId) {
  return loadFsmContext(pool, apptId)
}

/** 将当前有效 spin 的 reveal 时间拨到过去，触发 SPINNING → VETO_PHASE */
async function fastForwardSpinReveal(pool, appointmentId) {
  await pool.query(
    `UPDATE room_spins
     SET server_timestamp_ms = $2, reveal_timestamp_ms = $3
     WHERE appointment_id = $1 AND invalidated_at IS NULL`,
    [appointmentId, Date.now() - 10_000, Date.now() - 500],
  )
}

async function ensurePresence(pool, appointmentId, userIds) {
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

async function ensureFsmSchema(pool) {
  await pool.query(
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS room_kind TEXT NOT NULL DEFAULT 'scheduled'`,
  )
  await pool.query(
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS room_phase TEXT NOT NULL DEFAULT 'LOBBY'`,
  )
  await pool.query(
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS room_round INTEGER NOT NULL DEFAULT 0`,
  )
  await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS active_spin_id UUID`)
  await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS final_game_id INTEGER`)
  await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS final_game_title TEXT`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_spins (
      spin_id UUID PRIMARY KEY,
      appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
      room_id TEXT NOT NULL,
      host_clerk_user_id TEXT NOT NULL,
      seed BIGINT NOT NULL,
      result_game_id INTEGER NOT NULL,
      result_game_title TEXT NOT NULL,
      tier_rank SMALLINT NOT NULL,
      spin_duration_ms INTEGER NOT NULL,
      server_timestamp_ms BIGINT NOT NULL,
      reveal_timestamp_ms BIGINT NOT NULL,
      round_number INTEGER NOT NULL DEFAULT 0,
      invalidated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `ALTER TABLE room_spins ADD COLUMN IF NOT EXISTS round_number INTEGER NOT NULL DEFAULT 0`,
  ).catch(() => {})
  await pool.query(`ALTER TABLE room_spins ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ`).catch(() => {})
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_game_votes (
      appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
      clerk_user_id TEXT NOT NULL,
      vote TEXT NOT NULL CHECK (vote IN ('approve', 'reject')),
      game_title TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (appointment_id, clerk_user_id)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_game_vetoes (
      id BIGSERIAL PRIMARY KEY,
      appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
      clerk_user_id TEXT NOT NULL,
      game_title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_wish_pool (
      appointment_id UUID PRIMARY KEY REFERENCES appointments (id) ON DELETE CASCADE,
      slot1_game_id INTEGER,
      slot2_game_id INTEGER,
      slot3_game_id INTEGER,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_presence (
      appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
      clerk_user_id TEXT NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (appointment_id, clerk_user_id)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_case_draw_logs (
      id BIGSERIAL PRIMARY KEY,
      appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
      clerk_user_id TEXT NOT NULL,
      game_id INTEGER,
      game_title TEXT NOT NULL,
      tier_rank SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_player_ready (
      appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
      clerk_user_id TEXT NOT NULL,
      is_ready BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (appointment_id, clerk_user_id)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_events (
      event_id UUID PRIMARY KEY,
      appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
      room_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      clerk_user_id TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function seedTestRoom(pool) {
  const host = VIRTUAL_USERS[0]
  const roomId = `rm_${randomBytes(8).toString('hex')}`

  const ins = await pool.query(
    `INSERT INTO appointments (
       host_id, scheduled_at, room_id, status, room_kind, room_phase
     )
     VALUES ($1, now() - interval '1 minute', $2, 'confirmed', 'instant', 'LOBBY')
     RETURNING id, host_id, room_id, scheduled_at`,
    [host.id, roomId],
  )
  const appt = ins.rows[0]

  for (const u of VIRTUAL_USERS) {
    await pool.query(
      `INSERT INTO clerk_synced_users (clerk_user_id, primary_email, username, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (clerk_user_id)
       DO UPDATE SET primary_email = EXCLUDED.primary_email, username = EXCLUDED.username`,
      [u.id, u.email, u.label],
    )
    if (!u.isHost) {
      await pool.query(
        `INSERT INTO appointment_participants (appointment_id, email, status)
         VALUES ($1, $2, 'accepted')`,
        [appt.id, u.email],
      )
    }
  }

  const games = await pool.query(`SELECT id FROM reference_games ORDER BY id LIMIT 3`)
  const gameIds =
    games.rows.length >= 3
      ? games.rows.map((r) => r.id)
      : [games.rows[0]?.id ?? 1, games.rows[0]?.id ?? 1, 0]

  return { appt, gameIds }
}

async function dispatch(pool, appt, user, type, payload = {}) {
  return processRoomEvent(
    pool,
    {
      appt,
      userId: user.id,
      isHost: appt.host_id === user.id,
    },
    { type, payload },
  )
}

async function cleanup(pool, apptId) {
  const exists = await pool.query(`SELECT 1 FROM appointments WHERE id = $1`, [apptId])
  if (!exists.rows.length) {
    for (const u of VIRTUAL_USERS) {
      await pool.query(`DELETE FROM clerk_synced_users WHERE clerk_user_id = $1`, [u.id])
    }
    return
  }
  await pool.query(`DELETE FROM room_events WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM room_spins WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM room_game_votes WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM room_game_vetoes WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM room_wish_pool WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM room_player_ready WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM room_presence WHERE appointment_id = $1`, [apptId])
  await pool.query(`DELETE FROM room_case_draw_logs WHERE appointment_id = $1`, [apptId])
  await pool.query(
    `DELETE FROM appointment_participants WHERE appointment_id = $1`,
    [apptId],
  )
  await pool.query(`DELETE FROM appointments WHERE id = $1`, [apptId])
  for (const u of VIRTUAL_USERS) {
    await pool.query(`DELETE FROM clerk_synced_users WHERE clerk_user_id = $1`, [u.id])
  }
}

/** 可选：对已运行的 server 抽样 GET /live（需 FSM_TEST_BEARER_HOST） */
async function smokeHttpLive(roomId, hostBearer) {
  if (!hostBearer) return { skipped: true }
  try {
    const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/live`, {
      headers: { Authorization: `Bearer ${hostBearer}` },
    })
    const data = await res.json()
    return { skipped: false, status: res.status, phase: data.roomPhase, ok: res.ok }
  } catch (e) {
    return { skipped: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function runFsmFlow(pool) {
  let step = 0
  const { appt, gameIds } = await seedTestRoom(pool)
  const host = VIRTUAL_USERS[0]
  const dissenter = VIRTUAL_USERS[1]

  log('\n=== Glitchub 五用户 FSM 流程测试 ===')
  log(`房间: ${appt.room_id} | 预约 instant | 测试前缀: ${PREFIX}\n`)

  let phase = await loadPhase(pool, appt.id)
  record(++step, '创建预约房 + 5 人入库', phase, phase === RoomPhase.LOBBY, `room=${appt.room_id}`)

  await ensurePresence(pool, appt.id, VIRTUAL_USERS.map((u) => u.id))

  // 0 全员 LOBBY Ready（房主开始前置条件）
  let r
  for (const u of VIRTUAL_USERS) {
    r = await dispatch(pool, appt, u, EventType.PLAYER_READY_TOGGLED, { ready: true })
    if (!r.ok) break
  }
  phase = await loadPhase(pool, appt.id)
  record(
    ++step,
    '全员: LOBBY PLAYER_READY_TOGGLED ×5',
    phase,
    r.ok && phase === RoomPhase.LOBBY,
    '仍为 LOBBY，等待房主开始',
  )

  // 1 房主开始游戏
  r = await dispatch(pool, appt, host, EventType.GAME_START_REQUESTED)
  phase = r.phase ?? (await loadPhase(pool, appt.id))
  record(
    ++step,
    '房主: GAME_START_REQUESTED',
    phase,
    r.ok && phase === RoomPhase.WISH_COLLECTION,
  )

  // 2 全员许愿池
  for (const u of VIRTUAL_USERS) {
    r = await dispatch(pool, appt, u, EventType.WISHLIST_UPDATED, { gameIds })
    if (!r.ok) break
  }
  phase = await loadPhase(pool, appt.id)
  record(++step, '全员: WISHLIST_UPDATED ×5', phase, r.ok && phase === RoomPhase.WISH_COLLECTION)

  // 3 全员准备（应自动 READY_LOCK）
  for (const u of VIRTUAL_USERS) {
    await ensurePresence(pool, appt.id, VIRTUAL_USERS.map((x) => x.id))
    r = await dispatch(pool, appt, u, EventType.PLAYER_READY_TOGGLED, { ready: true })
    if (!r.ok) break
  }
  phase = await loadPhase(pool, appt.id)
  record(
    ++step,
    '全员: PLAYER_READY_TOGGLED',
    phase,
    r.ok && phase === RoomPhase.READY_LOCK,
    '全部在线且已准备',
  )

  // 4 第一轮抽奖
  r = await dispatch(pool, appt, host, EventType.SPIN_STARTED)
  phase = r.phase ?? (await loadPhase(pool, appt.id))
  const spin1Title = r.spin?.resultGameTitle ?? ''
  record(
    ++step,
    '房主: SPIN_STARTED (第1轮)',
    phase,
    r.ok && phase === RoomPhase.SPINNING,
    `抽中: ${spin1Title}`,
  )

  await fastForwardSpinReveal(pool, appt.id)
  await syncFsmOnRead(pool, appt)
  phase = await loadPhase(pool, appt.id)
  record(++step, '系统: SPIN_REVEALED (快进时间轴)', phase, phase === RoomPhase.VETO_PHASE)

  // 5 用户2反对，其余赞成 → 应重抽
  await ensurePresence(pool, appt.id, VIRTUAL_USERS.map((u) => u.id))
  r = await dispatch(pool, appt, dissenter, EventType.VETO_USED, {
    vote: 'reject',
    gameTitle: spin1Title,
  })
  let veto1 = r.vetoOutcome ?? 'pending'
  record(
    ++step,
    `${dissenter.label}: VETO_USED reject`,
    r.phase ?? phase,
    r.ok,
    `outcome=${veto1}`,
  )

  for (const u of VIRTUAL_USERS.filter((x) => x.id !== dissenter.id)) {
    r = await dispatch(pool, appt, u, EventType.VETO_USED, {
      vote: 'approve',
      gameTitle: spin1Title,
    })
    if (r.vetoOutcome === 'respun' || r.vetoOutcome === 'finalized') veto1 = r.vetoOutcome
    if (r.phase === RoomPhase.SPINNING || r.phase === RoomPhase.RESPINNING) veto1 = 'respun'
  }
  phase = await loadPhase(pool, appt.id)
  const snapAfterVeto = await loadSnapshot(pool, appt.id)
  const respunOk =
    veto1 === 'respun' &&
    (phase === RoomPhase.SPINNING ||
      phase === RoomPhase.RESPINNING ||
      phase === RoomPhase.VETO_PHASE)
  record(
    ++step,
    '其余 4 人: VETO_USED approve → 触发重抽',
    phase,
    respunOk,
    `outcome=${veto1}, round=${snapAfterVeto?.round}`,
  )

  // 6 第二轮（自动重抽后）
  await fastForwardSpinReveal(pool, appt.id)
  await syncFsmOnRead(pool, appt)
  phase = await loadPhase(pool, appt.id)
  const spin2 = snapAfterVeto?.activeSpin ?? (await loadSnapshot(pool, appt.id))?.activeSpin
  const spin2Title = spin2?.result_game_title ?? ''
  record(
    ++step,
    '系统: 否决后自动 RESPIN → SPINNING → VETO',
    phase,
    phase === RoomPhase.VETO_PHASE && Boolean(spin2Title),
    `新结果: ${spin2Title}`,
  )

  // 7 全员赞成 → FINALIZED
  await ensurePresence(pool, appt.id, VIRTUAL_USERS.map((u) => u.id))
  let finalOutcome = 'pending'
  for (const u of VIRTUAL_USERS) {
    r = await dispatch(pool, appt, u, EventType.VETO_USED, {
      vote: 'approve',
      gameTitle: spin2Title,
    })
    if (r.vetoOutcome) finalOutcome = r.vetoOutcome
  }
  phase = await loadPhase(pool, appt.id)
  const fin = await loadSnapshot(pool, appt.id)
  record(
    ++step,
    '全员: VETO_USED approve (第2轮)',
    phase,
    finalOutcome === 'finalized' && phase === RoomPhase.FINALIZED,
    `finalGame=${fin?.appt.final_game_title ?? '?'}`,
  )

  const events = await pool.query(
    `SELECT event_type, clerk_user_id, created_at
     FROM room_events WHERE appointment_id = $1 ORDER BY created_at`,
    [appt.id],
  )

  // 8 房主结束房间（会删除 appointment 行）
  r = await dispatch(pool, appt, host, EventType.ROOM_CLOSED)
  record(
    ++step,
    '房主: ROOM_CLOSED',
    RoomPhase.CLOSED,
    Boolean(r.ok && r.deleted),
    `deleted=${Boolean(r.deleted)}`,
  )

  return {
    appt,
    success: journal.every((j) => j.ok),
    spin1Title,
    spin2Title,
    finalGameTitle: fin?.appt.final_game_title,
    eventCount: events.rows.length,
    events: events.rows,
  }
}

function printReport(result) {
  log('\n--- 过程摘要 ---')
  for (const j of journal) {
    log(
      `${j.ok ? '✓' : '✗'} ${String(j.step).padStart(2)}. ${j.action.padEnd(36)} [${j.phase}] ${j.detail}`,
    )
  }

  log('\n--- 结果 ---')
  log(`整体: ${result.success ? '通过' : '失败'}`)
  log(`第 1 轮开奖: ${result.spin1Title}`)
  log(`第 2 轮开奖(重抽后): ${result.spin2Title}`)
  log(`最终锁定游戏: ${result.finalGameTitle}`)
  log(`事件日志条数: ${result.eventCount}`)

  if (result.events?.length) {
    log('\n--- room_events (类型) ---')
    const types = result.events.map((e) => e.event_type)
    log(types.join(' → '))
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    console.error('缺少 DATABASE_URL')
    process.exit(1)
  }

  const pool = new pg.Pool({ connectionString })
  let apptId = null

  try {
    const cat = await pool.query(`SELECT COUNT(*)::int AS n FROM reference_games`)
    if ((cat.rows[0]?.n ?? 0) < 1) {
      console.error('reference_games 为空，请先: npm run db:seed:reference-catalog')
      process.exit(1)
    }

    await ensureFsmSchema(pool)
    const result = await runFsmFlow(pool)
    apptId = result.appt.id
    printReport(result)

    if (USE_HTTP) {
      const hostBearer = process.env.FSM_TEST_BEARER_HOST?.trim()
      const http = await smokeHttpLive(result.appt.room_id, hostBearer)
      log('\n--- HTTP 抽样 ---')
      if (http.skipped) {
        log('跳过 (未设置 FSM_TEST_BEARER_HOST)')
      } else if (http.error) {
        log(`GET /live 失败: ${http.error}`)
      } else {
        log(`GET /live → ${http.status} roomPhase=${http.phase}`)
      }
    }

    if (!result.success) {
      process.exitCode = 1
      log('\n存在失败步骤，请检查上方 ✗ 标记。')
    } else {
      log('\n全部步骤通过。')
    }
  } catch (err) {
    console.error('测试异常:', err)
    process.exitCode = 1
  } finally {
    if (apptId) {
      try {
        await cleanup(pool, apptId)
        log(`\n已清理测试数据 (appointment ${apptId})`)
      } catch (e) {
        console.warn('清理失败:', e instanceof Error ? e.message : e)
      }
    }
    await pool.end()
  }
}

main()
