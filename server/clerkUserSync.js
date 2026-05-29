import { Resend } from 'resend'

/**
 * @param {Record<string, unknown>} d Clerk User JSON（Webhook payload.data）
 */
function primaryEmailFromClerkUser(d) {
  const emails = d.email_addresses
  if (!Array.isArray(emails) || emails.length === 0) return null
  const pid = d.primary_email_address_id
  const primary = emails.find((e) => e && typeof e === 'object' && e.id === pid)
  const pick = primary ?? emails[0]
  const raw =
    pick && typeof pick === 'object' && typeof pick.email_address === 'string'
      ? pick.email_address
      : null
  const t = raw?.trim().toLowerCase()
  return t || null
}

function str(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

/**
 * @param {import('pg').Pool | null} pool
 * @param {Record<string, unknown>} d
 */
async function upsertClerkUserToNeon(pool, d) {
  if (!pool) {
    console.warn('[clerk-user-sync] Skipping Neon: DATABASE_URL not configured')
    return { ok: false, skipped: true }
  }

  const id = str(d.id)
  if (!id) {
    console.warn('[clerk-user-sync] Missing user id, skipping Neon')
    return { ok: false, skipped: true }
  }

  const email = primaryEmailFromClerkUser(d)
  const firstName = str(d.first_name)
  const lastName = str(d.last_name)
  const username = str(d.username)
  const imageUrl = str(d.image_url ?? d.profile_image_url)
  const createdMs =
    typeof d.created_at === 'number'
      ? d.created_at
      : typeof d.created_at === 'string'
        ? Number(d.created_at)
        : null

  await pool.query(
    `INSERT INTO clerk_synced_users
      (clerk_user_id, primary_email, first_name, last_name, username, image_url, clerk_created_at)
     VALUES (
       $1, $2, $3, $4, $5, $6,
       CASE
         WHEN $7::bigint IS NOT NULL AND $7::bigint > 0
         THEN to_timestamp(($7::bigint)::double precision / 1000.0) AT TIME ZONE 'UTC'
         ELSE NULL
       END
     )
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       primary_email = COALESCE(EXCLUDED.primary_email, clerk_synced_users.primary_email),
       first_name = COALESCE(EXCLUDED.first_name, clerk_synced_users.first_name),
       last_name = COALESCE(EXCLUDED.last_name, clerk_synced_users.last_name),
       username = COALESCE(EXCLUDED.username, clerk_synced_users.username),
       image_url = COALESCE(EXCLUDED.image_url, clerk_synced_users.image_url),
       clerk_created_at = COALESCE(clerk_synced_users.clerk_created_at, EXCLUDED.clerk_created_at),
       updated_at = now()`,
    [
      id,
      email,
      firstName,
      lastName,
      username,
      imageUrl,
      Number.isFinite(createdMs) && createdMs > 0 ? Math.floor(createdMs) : null,
    ],
  )

  return { ok: true }
}

/**
 * @param {Record<string, unknown>} d
 */
async function upsertResendContact(d) {
  const key = process.env.RESEND_API_KEY?.trim()
  const audienceId = process.env.RESEND_AUDIENCE_ID?.trim()
  if (!key || !audienceId) {
    console.warn(
      '[clerk-user-sync] Skipping Resend Contact: RESEND_API_KEY and RESEND_AUDIENCE_ID required',
    )
    return { ok: false, skipped: true }
  }

  const email = primaryEmailFromClerkUser(d)
  if (!email) {
    console.warn('[clerk-user-sync] No primary email, skipping Resend Contact')
    return { ok: false, skipped: true }
  }

  const resend = new Resend(key)
  const firstName = str(d.first_name) ?? undefined
  const lastName = str(d.last_name) ?? undefined

  const { data, error } = await resend.contacts.create({
    audienceId,
    email,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
  })

  if (error) {
    const msg = error.message ?? String(error)
    /** 已存在时 Resend 可能返回冲突类错误，视为可接受 */
    if (/already exists|duplicate|409/i.test(msg)) {
      console.log('[clerk-user-sync] Resend contact already exists:', email)
      return { ok: true, duplicate: true }
    }
    const restricted =
      error.name === 'restricted_api_key' ||
      /restricted to only send emails/i.test(msg)
    if (restricted) {
      console.warn(
        '[clerk-user-sync] Skipping Resend contact: API key is send-only. Create a key with Audiences/Contacts permissions and update RESEND_API_KEY.',
      )
      return { ok: false, skipped: true, restricted: true }
    }
    console.error('[clerk-user-sync] Failed to create Resend contact:', error)
    return { ok: false, error }
  }

  console.log('[clerk-user-sync] Resend contact created:', email, data?.id)
  return { ok: true, id: data?.id }
}

/**
 * @param {import('pg').Pool | null} pool
 * @param {{ type: string; data: Record<string, unknown> }} evt
 */
export async function processClerkUserWebhookEvent(pool, evt) {
  if (evt.type !== 'user.created' && evt.type !== 'user.updated') {
    return
  }

  const d = evt.data
  if (!d || typeof d !== 'object') return

  try {
    await upsertClerkUserToNeon(pool, d)
  } catch (e) {
    console.error('[clerk-user-sync] Neon upsert failed:', e)
  }

  try {
    await upsertResendContact(d)
  } catch (e) {
    console.error('[clerk-user-sync] Resend contact failed:', e)
  }
}
