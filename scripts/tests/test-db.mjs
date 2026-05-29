import 'dotenv/config'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Missing DATABASE_URL. Copy .env.example to .env and set DATABASE_URL.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url })
try {
  const { rows } = await pool.query('SELECT current_database() AS database, 1 AS ok')
  console.log('Connection OK:', rows[0])
} catch (err) {
  console.error('Connection failed:', err instanceof Error ? err.message : err)
  process.exit(1)
} finally {
  await pool.end()
}
