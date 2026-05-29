/**
 * 手动清理：预约 scheduled_at + ROOM_AUTO_EXPIRE_HOURS 后已过期的房间。
 * Run: npm run db:purge:stale-rooms
 */
import 'dotenv/config'
import pg from 'pg'
import {
  purgeStaleUnenteredRooms,
  roomAutoExpireHours,
} from '../server/roomExpire.js'

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    console.error('Missing DATABASE_URL')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString })
  try {
    await pool.query(
      `ALTER TABLE appointments
       ADD COLUMN IF NOT EXISTS first_entered_at TIMESTAMPTZ`,
    )
    const hours = roomAutoExpireHours()
    console.log(`Sweeping rooms expired ${hours}h after scheduled_at…`)
    const result = await purgeStaleUnenteredRooms(pool)
    if (result.deleted === 0) {
      console.log('No stale rooms to delete.')
    } else {
      console.log(`Deleted ${result.deleted} invitation(s):`)
      for (const rid of result.roomIds) {
        console.log(`  - ${rid}`)
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
