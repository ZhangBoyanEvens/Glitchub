/**
 * appointments.first_entered_at — 用于判定是否有人进入房间。
 * Run: npm run db:migrate:appointment-entered
 */
import 'dotenv/config'
import pg from 'pg'

const sql = `
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS first_entered_at TIMESTAMPTZ;
`

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    console.error('Missing DATABASE_URL')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString })
  try {
    await pool.query(sql)
    console.log('appointments.first_entered_at migration OK.')
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
