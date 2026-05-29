import { processClerkUserWebhookEvent } from './clerkUserSync.js'
import { verifyWebhook } from '@clerk/backend/webhooks'
import express from 'express'

/**
 * 将 Express 请求转为 Web Fetch Request（供 verifyWebhook 读取 body 与 Svix 头）
 * @param {import('express').Request} req
 */
function toWebRequest(req) {
  const host = req.get('host') || '127.0.0.1'
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http'
  const path = req.originalUrl || req.url || '/api/webhooks/clerk'
  const url = `${proto}://${host}${path}`

  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item)
    } else {
      headers.set(k, v)
    }
  }

  const body = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : '', 'utf8')

  return new Request(url, { method: 'POST', headers, body })
}

/**
 * Clerk Webhook（Svix 验签）。须在 `express.json()` 之前注册，且本路由使用 raw body。
 * @param {import('express').Express} app
 * @param {import('pg').Pool | null} pool
 */
export function registerClerkWebhookRoute(app, pool) {
  app.post(
    '/api/webhooks/clerk',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()
      if (!secret) {
        res
          .status(503)
          .json({ ok: false, message: 'CLERK_WEBHOOK_SIGNING_SECRET is not configured' })
        return
      }

      try {
        const request = toWebRequest(req)
        const evt = await verifyWebhook(request, { signingSecret: secret })

        console.log('[clerk-webhook]', evt.type, evt.data?.id ?? '')

        await processClerkUserWebhookEvent(pool, evt)

        res.json({ ok: true, type: evt.type })
      } catch (err) {
        console.error('[clerk-webhook] verify failed', err)
        res.status(400).json({
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
  )
}
