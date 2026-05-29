/**
 * 冒烟：直接调用 processClerkUserWebhookEvent（Neon upsert + Resend Contact）。
 *
 * 用法：
 *   npm run test:clerk-user-sync -- you@example.com
 * 或在 .env 设置 CLERK_SYNC_TEST_EMAIL=you@example.com 后：
 *   npm run test:clerk-user-sync
 *
 * 需要：DATABASE_URL、RESEND_API_KEY、RESEND_AUDIENCE_ID（与 Webhook 一致）
 */
import 'dotenv/config'
import pg from 'pg'
import { processClerkUserWebhookEvent } from '../../server/clerkUserSync.js'

const emailArg = process.argv.slice(2).find((a) => !a.startsWith('-'))
const email = (emailArg || process.env.CLERK_SYNC_TEST_EMAIL || '').trim().toLowerCase()
if (!email || !email.includes('@')) {
  console.error(
    '请提供测试邮箱（会写入 Neon 与 Resend Audience），例如：\n' +
      '  npm run test:clerk-user-sync -- you@example.com\n' +
      '或在 .env 中设置 CLERK_SYNC_TEST_EMAIL=you@example.com',
  )
  process.exit(1)
}

const clerkUserId = `user_sync_smoke_${Date.now()}`
const emailId = `ema_sync_smoke_${Date.now()}`

const evt = {
  type: 'user.created',
  data: {
    id: clerkUserId,
    object: 'user',
    first_name: 'Webhook',
    last_name: 'Smoke',
    username: null,
    image_url: null,
    created_at: Date.now(),
    primary_email_address_id: emailId,
    email_addresses: [
      {
        id: emailId,
        email_address: email,
        object: 'email_address',
      },
    ],
  },
}

const connectionString = process.env.DATABASE_URL?.trim()
let pool = null
if (connectionString) {
  pool = new pg.Pool({ connectionString })
}

console.log('clerk_user_id:', clerkUserId)
console.log('email:', email)
console.log('DATABASE_URL:', connectionString ? '已配置' : '未配置（仅测 Resend）')

await processClerkUserWebhookEvent(pool, evt)

if (pool) {
  const { rows } = await pool.query(
    'SELECT clerk_user_id, primary_email, first_name, last_name FROM clerk_synced_users WHERE clerk_user_id = $1',
    [clerkUserId],
  )
  if (rows.length === 0) {
    console.error('Neon 校验失败：未找到刚写入的行（是否已执行 npm run db:migrate:clerk-synced-users？）')
    await pool.end()
    process.exit(1)
  }
  console.log('Neon 校验 OK:', rows[0])
  await pool.end()
} else {
  console.log('Neon 未校验（无 DATABASE_URL）')
}

console.log(
  '完成：Neon 已校验；Resend 若使用「仅发信」Key 会跳过 Audience，请换带 Contacts 权限的 Key 后重试本脚本。',
)
