/**
 * 验证 Resend API Key（不发送真实邮件）。
 * - 全权限 Key：调用 domains.list
 * - 仅发信 Key：POST /emails 空对象，预期 422「缺少 to」表示鉴权通过
 * 用法：npm run test:resend
 */
import 'dotenv/config'
import { Resend } from 'resend'

const key = process.env.RESEND_API_KEY?.trim()
if (!key) {
  console.error('缺少 RESEND_API_KEY，请在 .env 中配置后重试。')
  process.exit(1)
}

const resend = new Resend(key)

const domainResult = await resend.domains.list()
if (!domainResult.error) {
  const list = domainResult.data?.data
  console.log('Resend 连接成功（可读取域名列表）。')
  console.log('已配置域名数量:', Array.isArray(list) ? list.length : 0)
  if (Array.isArray(list) && list.length > 0) {
    console.log(
      '域名列表:',
      list.map((d) => `${d.name} (${d.status})`).join(', '),
    )
  }
  process.exit(0)
}

const err = domainResult.error
const restricted =
  err?.name === 'restricted_api_key' ||
  String(err?.message ?? '').toLowerCase().includes('restricted')

if (!restricted) {
  console.error('Resend 连接失败:', err)
  process.exit(1)
}

console.log(
  '检测到「仅发信」受限 API Key，改用 POST /emails 校验（故意空 body，不投递邮件）…',
)

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: '{}',
})

const text = await res.text()
let json
try {
  json = JSON.parse(text)
} catch {
  json = null
}

/** 422 且为缺少字段类校验 = 已通过 API Key 鉴权，未真正发信 */
if (
  res.status === 422 &&
  (json?.name === 'missing_required_field' ||
    String(json?.message ?? '').includes('to'))
) {
  console.log('Resend 连接成功：API Key 有效（仅发信权限）。')
  console.log('服务端提示:', json?.message ?? text)
  console.log('发信前请确认 RESEND_FROM_EMAIL 使用已在 Resend 验证的域名。')
  process.exit(0)
}

if (res.status === 401) {
  console.error('Resend API Key 无效:', text)
  process.exit(1)
}

console.error('Resend 未预期响应:', res.status, text)
process.exit(1)
