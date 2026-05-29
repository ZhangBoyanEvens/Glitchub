/**
 * 根据姓名/标识生成加入码 slug（小写、去空格与符号），如 Evens Zhang → evenszhang
 * @param {{ firstName?: string | null; lastName?: string | null; identifier?: string | null }} profile
 */
export function slugFromProfile(profile) {
  const combined = [profile.firstName, profile.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
  const source = combined || profile.identifier || 'user'
  const ascii = source.normalize('NFKD').replace(/\p{M}/gu, '')
  const lower = ascii
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '')
  const core = (lower || 'user').slice(0, 36)
  return core
}

/**
 * 为 Clerk 用户分配并持久化全局唯一的 join_uid（冲突时追加数字后缀）
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function ensureJoinUid(db, clerkUserId, profile) {
  const sel = await db.query(
    'SELECT join_uid FROM app_user_join_uid WHERE clerk_user_id = $1',
    [clerkUserId],
  )
  if (sel.rows.length) return sel.rows[0].join_uid

  const base = slugFromProfile(profile)
  const sourceLabel =
    [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() ||
    profile.identifier ||
    ''

  for (let i = 0; i < 100; i++) {
    const candidate = (i === 0 ? base : `${base}${i}`).toLowerCase().slice(0, 48)
    try {
      await db.query(
        `INSERT INTO app_user_join_uid (clerk_user_id, join_uid, source_label)
         VALUES ($1, $2, $3)`,
        [clerkUserId, candidate, sourceLabel],
      )
      return candidate
    } catch (e) {
      if (e && e.code === '23505') continue
      throw e
    }
  }
  throw new Error('Could not allocate unique join_uid')
}
