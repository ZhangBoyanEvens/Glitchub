/**
 * 测试 Clerk Webhook 验签。
 *
 * 默认：本地构造 Svix 签名并调用 verifyWebhook（不启服务）。
 * HTTP：npm run test:clerk-webhook -- --http
 *        需先启动 npm run server:dev，请求发到 http://127.0.0.1:8787/api/webhooks/clerk
 *
 * 需要 .env 中 CLERK_WEBHOOK_SIGNING_SECRET=whsec_...（Dashboard 里复制的完整值，非占位符）
 */
import 'dotenv/config'
import { verifyWebhook } from '@clerk/backend/webhooks'
import { Webhook } from 'svix'

const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()
if (!secret) {
  console.error('缺少 CLERK_WEBHOOK_SIGNING_SECRET。')
  process.exit(1)
}

let wh
try {
  wh = new Webhook(secret)
} catch (e) {
  console.error(
    'Signing Secret 无法解析（常见于占位符或复制不完整）。',
    '请到 Clerk Dashboard → Webhooks → 你的 Endpoint → Signing Secret，复制完整 whsec_… 写入 .env。',
  )
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}

const payload = JSON.stringify({
  type: 'user.created',
  object: 'event',
  data: {
    id: 'user_test_webhook',
    object: 'user',
  },
})

const msgId = `msg_test_${Date.now()}`
const timestamp = new Date()
const svixSignature = wh.sign(msgId, timestamp, payload)
const svixTimestamp = String(Math.floor(timestamp.getTime() / 1000))

const headers = {
  'content-type': 'application/json',
  'svix-id': msgId,
  'svix-timestamp': svixTimestamp,
  'svix-signature': svixSignature,
}

const useHttp = process.argv.includes('--http')
const base =
  process.env.WEBHOOK_TEST_BASE_URL?.replace(/\/$/, '') ||
  'http://127.0.0.1:8787'

if (useHttp) {
  const url = `${base}/api/webhooks/clerk`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: payload,
  })
  const text = await res.text()
  console.log('HTTP', res.status, url)
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text)
  }
  process.exit(res.ok ? 0 : 1)
}

const request = new Request('http://127.0.0.1/api/webhooks/clerk', {
  method: 'POST',
  headers,
  body: payload,
})

try {
  const evt = await verifyWebhook(request, { signingSecret: secret })
  console.log('Clerk Webhook 验签成功（与 Express 路由使用同一套 verifyWebhook）。')
  console.log('事件类型:', evt.type, '| data.id:', evt.data?.id)
  console.log('')
  console.log('若要连本机服务一起测：先 npm run server:dev，再执行：')
  console.log('  npm run test:clerk-webhook -- --http')
  process.exit(0)
} catch (e) {
  console.error('验签失败:', e instanceof Error ? e.message : e)
  process.exit(1)
}
