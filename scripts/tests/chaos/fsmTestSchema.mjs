/** FSM 测试用表结构（与 server/index.js 启动迁移对齐） */
export async function ensureFsmSchema(pool) {
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
      reject_count INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_room_game_vetoes_appt_user
      ON room_game_vetoes (appointment_id, clerk_user_id)
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
