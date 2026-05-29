/**
 * 房间在线心跳：谁在房间内（用于成员列表在线态）。
 * 用法: DATABASE_URL=... node scripts/db-migrate-room-presence.mjs
 */
import 'dotenv/config'
import pg from 'pg'

const sql = `
CREATE TABLE IF NOT EXISTS room_presence (
  appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, clerk_user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_presence_last_seen
  ON room_presence (appointment_id, last_seen_at DESC);
`

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    console.error('缺少 DATABASE_URL')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString })
  try {
    await pool.query(sql)
    console.log('room_presence 迁移完成。')
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
