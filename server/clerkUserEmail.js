import { createClerkClient } from '@clerk/backend'
import { cached, TTL } from './roomCache.js'

/**
 * Primary email（小写）。热路径优先 Neon，避免每次请求打 Clerk API。
 *
 * @param {import('pg').Pool | null} pool
 * @param {string} userId
 * @returns {Promise<string | null>}
 */
export async function resolveUserPrimaryEmailLower(pool, userId) {
  return cached(
    `email-resolve:${userId}`,
    () => resolveUserPrimaryEmailLowerUncached(pool, userId),
    TTL.userEmailMs,
  )
}

/**
 * @param {import('pg').Pool | null} pool
 * @param {string} userId
 */
async function resolveUserPrimaryEmailLowerUncached(pool, userId) {
  if (pool) {
    try {
      const r = await pool.query(
        `SELECT primary_email FROM clerk_synced_users WHERE clerk_user_id = $1`,
        [userId],
      )
      const em = r.rows[0]?.primary_email?.trim().toLowerCase()
      if (em) return em
    } catch {
      /* table may be missing */
    }
  }

  const sk = process.env.CLERK_SECRET_KEY?.trim()
  if (!sk) return null

  try {
    const clerk = createClerkClient({ secretKey: sk })
    const user = await clerk.users.getUser(userId)
    const pid = user.primaryEmailAddressId
    const list = user.emailAddresses ?? []
    const pick = list.find((e) => e.id === pid) ?? list[0]
    const em = pick?.emailAddress?.trim().toLowerCase()
    return em || null
  } catch (err) {
    console.warn('[clerkUserEmail] getUser failed:', err?.message ?? err)
    return null
  }
}
