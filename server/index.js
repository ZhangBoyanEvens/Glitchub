import 'dotenv/config'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { createDbPool } from './dbPool.js'
import { registerClerkWebhookRoute } from './clerkWebhook.js'
import { registerAppointmentInviteRespondRoutes } from './appointmentInviteRespond.js'
import { registerHostInvitationRoutes } from './hostInvitations.js'
import { registerRoomJoinRoutes } from './roomJoin.js'
import { registerRoomMembersRoutes } from './roomMembers.js'
import { registerRoomGameVoteRoutes } from './roomGameVotes.js'
import { registerRoomGameSessionRoutes } from './roomGameSession.js'
import { registerRoomEndRoutes } from './roomEnd.js'
import { registerRoomCaseDrawLogRoutes } from './roomCaseDrawLogs.js'
import { registerRoomWishPoolRoutes } from './roomWishPool.js'
import { registerResendHostInvitationEmailRoutes } from './resendHostInvitationEmail.js'
import { startRoomExpireScheduler } from './roomExpire.js'
import { registerRoomInstantRoutes } from './roomInstant.js'
import { registerRoomLiveRoutes } from './roomLive.js'
import { registerRoomSpinRoutes } from './roomSpin.js'
import { attachRoomSpinWebSocket } from './roomSpinHub.js'
import { registerRoomFsmRoutes } from './roomFsm/roomService.js'
import { bootstrapOrgGames, registerOrgGameRoutes } from './orgGames/orgGameRoutes.js'
import { ensureReputationSchema } from './reputation/reputationService.js'

const app = express()
const port = Number(process.env.PORT ?? 8787)

const connectionString = process.env.DATABASE_URL?.trim()

/** 无 DATABASE_URL 时仍启动 HTTP，避免前端代理 ECONNREFUSED；DB 路由返回 503 */
let pool = null
if (connectionString) {
  pool = createDbPool(connectionString)
  pool.on('error', (err) => {
    console.error('[server] Postgres pool idle client error:', err?.message ?? err)
  })
  try {
    await pool.query(
      'ALTER TABLE host_invitation_invitees ADD COLUMN IF NOT EXISTS invitee_email TEXT',
    )
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : ''
    if (code === '42P01') {
      console.warn(
        '[server] host_invitation_invitees table does not exist; run npm run db:migrate:host-invitations first',
      )
    } else {
      console.warn('[server] auto-migrate invitee_email column failed:', err?.message ?? err)
    }
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS room_presence (
        appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
        clerk_user_id TEXT NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (appointment_id, clerk_user_id)
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_room_presence_last_seen
        ON room_presence (appointment_id, last_seen_at DESC)
    `)
  } catch (err) {
    console.warn('[server] auto-create room_presence table failed:', err?.message ?? err)
  }
  try {
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
      CREATE INDEX IF NOT EXISTS idx_room_game_votes_appointment
        ON room_game_votes (appointment_id)
    `)
  } catch (err) {
    console.warn('[server] auto-create room_game_votes table failed:', err?.message ?? err)
  }
  try {
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
      CREATE INDEX IF NOT EXISTS idx_room_case_draw_logs_appt_time
        ON room_case_draw_logs (appointment_id, created_at DESC)
    `)
  } catch (err) {
    console.warn('[server] auto-create room_case_draw_logs table failed:', err?.message ?? err)
  }
  try {
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
      ALTER TABLE room_wish_pool ALTER COLUMN slot1_game_id DROP NOT NULL
    `).catch(() => {})
    await pool.query(`
      ALTER TABLE room_wish_pool ALTER COLUMN slot2_game_id DROP NOT NULL
    `).catch(() => {})
    await pool.query(`
      ALTER TABLE room_wish_pool ALTER COLUMN slot3_game_id DROP NOT NULL
    `).catch(() => {})
  } catch (err) {
    console.warn('[server] auto-create room_wish_pool table failed:', err?.message ?? err)
  }
  try {
    await pool.query(
      `ALTER TABLE appointments
       ADD COLUMN IF NOT EXISTS first_entered_at TIMESTAMPTZ`,
    )
    await pool.query(
      `ALTER TABLE appointments
       ADD COLUMN IF NOT EXISTS game_started_at TIMESTAMPTZ`,
    )
    await pool.query(
      `ALTER TABLE appointments
       ADD COLUMN IF NOT EXISTS game_started_by TEXT`,
    )
    await pool.query(
      `ALTER TABLE appointments
       ADD COLUMN IF NOT EXISTS room_kind TEXT NOT NULL DEFAULT 'scheduled'`,
    )
    await pool.query(
      `ALTER TABLE appointments
       ADD COLUMN IF NOT EXISTS join_code TEXT`,
    )
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_instant_join_code_active
        ON appointments (join_code)
        WHERE room_kind = 'instant'
          AND status <> 'cancelled'
          AND join_code IS NOT NULL
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_room_id_norm
        ON appointments ((lower(trim(room_id))))
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_appt_participants_appt_active
        ON appointment_participants (appointment_id)
        WHERE status <> 'declined'
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_clerk_synced_users_email_norm
        ON clerk_synced_users ((lower(trim(primary_email))))
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_clerk_synced_users_clerk_id
        ON clerk_synced_users (clerk_user_id)
    `)
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_room_spins_appt_time
        ON room_spins (appointment_id, server_timestamp_ms DESC)
    `)
    await pool.query(
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS room_phase TEXT NOT NULL DEFAULT 'LOBBY'`,
    )
    await pool.query(
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS room_round INTEGER NOT NULL DEFAULT 0`,
    )
    await pool.query(
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS active_spin_id UUID`,
    )
    await pool.query(
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS final_game_id INTEGER`,
    )
    await pool.query(
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS final_game_title TEXT`,
    )
    await pool.query(
      `ALTER TABLE room_spins ADD COLUMN IF NOT EXISTS round_number INTEGER NOT NULL DEFAULT 0`,
    )
    await pool.query(
      `ALTER TABLE room_spins ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ`,
    )
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
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_room_events_appt_time
        ON room_events (appointment_id, created_at DESC)
    `)
    await pool.query(`
      UPDATE appointments
      SET room_phase = 'WISH_COLLECTION'
      WHERE game_started_at IS NOT NULL
        AND (room_phase IS NULL OR room_phase = 'LOBBY')
    `)
  } catch (err) {
    console.warn('[server] appointments column bootstrap failed:', err?.message ?? err)
  }
  try {
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
      CREATE INDEX IF NOT EXISTS idx_room_game_vetoes_user
        ON room_game_vetoes (appointment_id, clerk_user_id)
    `)
    await pool.query(`
      DELETE FROM room_game_vetoes a
      USING room_game_vetoes b
      WHERE a.appointment_id = b.appointment_id
        AND a.clerk_user_id = b.clerk_user_id
        AND a.id < b.id
    `)
    await pool.query(`
      ALTER TABLE room_game_vetoes
        ADD COLUMN IF NOT EXISTS reject_count INT NOT NULL DEFAULT 1
    `)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_room_game_vetoes_appt_user
        ON room_game_vetoes (appointment_id, clerk_user_id)
    `)
  } catch (err) {
    console.warn('[server] auto-create room_game_vetoes table failed:', err?.message ?? err)
  }
  startRoomExpireScheduler(pool)
  try {
    await bootstrapOrgGames(pool)
  } catch (err) {
    console.warn('[server] org games schema bootstrap failed:', err?.message ?? err)
  }
  try {
    await ensureReputationSchema(pool)
  } catch (err) {
    console.warn('[server] reputation schema bootstrap failed:', err?.message ?? err)
  }
} else {
  console.warn(
    '[server] DATABASE_URL is not set: /api/health, /api/catalog/*, /api/host-invitations, and Clerk webhook DB writes will be unavailable. Configure a Neon connection string in .env and restart.',
  )
}

app.use(cors({ origin: true }))
/** Clerk Webhook 必须使用 raw body 验签，须放在 express.json() 之前 */
registerClerkWebhookRoute(app, pool)
app.use(express.json())

app.get('/api/health', async (_req, res) => {
  if (!pool) {
    res.status(503).json({
      ok: false,
      db: null,
      message: 'DATABASE_URL is not configured; database unavailable',
    })
    return
  }
  try {
    const result = await pool.query('select 1 as ok')
    res.json({ ok: true, db: result.rows[0] })
  } catch (err) {
    console.error(err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, message })
  }
})

/** 原始游戏库：分类 + 游戏；档间 tier_pick_weight 归一化，档内均分 */
app.get('/api/catalog/reference-games', async (_req, res) => {
  if (!pool) {
    res.status(503).json({
      ok: false,
      message: 'DATABASE_URL is not configured. Copy .env.example to .env, add your Neon connection string, then run npm run server:dev',
    })
    return
  }
  try {
    const { rows: catRows } = await pool.query(
      `SELECT id, tier_rank, label_zh, display_name_zh, tier_pick_weight::float8 AS tier_pick_weight
       FROM reference_game_categories
       ORDER BY tier_rank`,
    )
    if (catRows.length === 0) {
      res.status(404).json({
        ok: false,
        message:
          'Empty catalog. Run: npm run db:seed:reference-catalog (DATABASE_URL required)',
      })
      return
    }

    const { rows: gameRows } = await pool.query(
      `SELECT id, category_id, sort_order, title
       FROM reference_games
       ORDER BY category_id, sort_order`,
    )

    const sumWeight = catRows.reduce(
      (acc, c) => acc + Number(c.tier_pick_weight),
      0,
    )

    const gamesByCategory = new Map()
    for (const g of gameRows) {
      const list = gamesByCategory.get(g.category_id) ?? []
      list.push({
        id: g.id,
        title: g.title,
        sort_order: g.sort_order,
      })
      gamesByCategory.set(g.category_id, list)
    }

    const categories = catRows.map((c) => {
      const games = gamesByCategory.get(c.id) ?? []
      const n = games.length || 1
      const tierNorm = Number(c.tier_pick_weight) / sumWeight
      const withinTierShare = 1 / n
      return {
        id: c.id,
        tier_rank: c.tier_rank,
        label_zh: c.label_zh,
        display_name_zh: c.display_name_zh,
        tier_pick_weight: Number(c.tier_pick_weight),
        tier_normalized_probability: tierNorm,
        within_tier_uniform_share: withinTierShare,
        games: games.map((g) => ({
          ...g,
          /** 理论独立抽样概率 ≈ 档概率 / 档内游戏数 */
          approx_pick_probability: tierNorm * withinTierShare,
        })),
      }
    })

    res.json({
      ok: true,
      tier_weight_sum: sumWeight,
      sampling_note:
        'Pick a tier with probability tier_pick_weight / tier_weight_sum; then pick uniformly among games in that tier.',
      categories,
    })
  } catch (err) {
    if (err && String(err.code) === '42P01') {
      res.status(404).json({
        ok: false,
        message:
          'Catalog tables missing. Run: npm run db:seed:reference-catalog',
      })
      return
    }
    console.error(err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, message })
  }
})

registerHostInvitationRoutes(app, pool)
registerAppointmentInviteRespondRoutes(app, pool)
registerRoomJoinRoutes(app, pool)
registerRoomInstantRoutes(app, pool)
registerRoomLiveRoutes(app, pool)
registerRoomSpinRoutes(app, pool)
registerRoomFsmRoutes(app, pool)
registerRoomMembersRoutes(app, pool)
registerRoomGameVoteRoutes(app, pool)
registerRoomGameSessionRoutes(app, pool)
registerRoomEndRoutes(app, pool)
registerRoomCaseDrawLogRoutes(app, pool)
registerRoomWishPoolRoutes(app, pool)
registerResendHostInvitationEmailRoutes(app, pool)
registerOrgGameRoutes(app, pool)

const isProduction = process.env.NODE_ENV === 'production'
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

if (isProduction) {
  app.use(express.static(distDir, { index: false }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    res.sendFile(path.join(distDir, 'index.html'), (err) => {
      if (err) next(err)
    })
  })
}

const host = process.env.HOST?.trim() || (isProduction ? '0.0.0.0' : '127.0.0.1')

const httpServer = http.createServer(app)
if (pool) {
  attachRoomSpinWebSocket(httpServer, pool)
}

httpServer.listen(port, host, () => {
  const mode = isProduction ? 'production' : 'development'
  console.log(`[server] ${mode} listening on http://${host}:${port} (HTTP + room WS)`)
})
