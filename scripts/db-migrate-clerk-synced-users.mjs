/**
 * Neon：同步 Clerk 用户（Webhook user.created / user.updated）
 * 用法：DATABASE_URL=... node scripts/db-migrate-clerk-synced-users.mjs
 */
import 'dotenv/config'
import pg from 'pg'

const sql = `
CREATE TABLE IF NOT EXISTS clerk_synced_users (
  clerk_user_id TEXT PRIMARY KEY,
  primary_email TEXT,
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  image_url TEXT,
  clerk_created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clerk_synced_users_email
  ON clerk_synced_users (lower(primary_email));
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
    console.log('clerk_synced_users 迁移完成。')
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
