/**
 * 冒烟：appointment_participants + POST /api/appointment-invite/respond
 *
 * 1) Neon 写入一条 appointments + participant（带 accept/decline token）
 * 2) 若本机 API 可连，则 POST accept / 二次 accept；再写第二条仅测 decline
 * 3) 清理测试行
 *
 * 用法：npm run test:appointment-invite
 * 可选：API_TEST_BASE=http://127.0.0.1:8787（默认）
 */
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const base =
  process.env.API_TEST_BASE?.replace(/\/$/, '') || 'http://127.0.0.1:8787'

function tok(prefix) {
  return `${prefix}_${randomBytes(16).toString('hex')}`
}

async function postRespond(body) {
  const res = await fetch(`${base}/api/appointment-invite/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json }
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    console.error('缺少 DATABASE_URL')
    process.exit(1)
  }

  const pool = new pg.Pool({ connectionString })
  let appointmentId
  let participantId
  let acceptToken
  let declineToken

  try {
    const insA = await pool.query(
      `INSERT INTO appointments (host_id, scheduled_at, room_id, status)
       VALUES ('test_smoke_host', now(), 'rm_smoke_invite', 'pending')
       RETURNING id`,
    )
    appointmentId = insA.rows[0].id
    acceptToken = tok('acpt')
    declineToken = tok('dcln')
    const insP = await pool.query(
      `INSERT INTO appointment_participants
        (appointment_id, email, status, accept_token, decline_token)
       VALUES ($1, 'smoke_invite_glitchub@example.com', 'invited', $2, $3)
       RETURNING id`,
      [appointmentId, acceptToken, declineToken],
    )
    participantId = insP.rows[0].id
    console.log('DB seed OK appointment', appointmentId, 'participant', participantId)

    let httpOk = false
    try {
      const r1 = await postRespond({ acceptToken })
      console.log('POST accept (1st)', r1.status, r1.json)
      if (r1.status !== 200 || !r1.json?.ok || r1.json.action !== 'accepted') {
        console.error('首次接受未成功')
        process.exitCode = 1
      } else if (!r1.json.roomId) {
        console.error('未返回 roomId')
        process.exitCode = 1
      } else {
        httpOk = true
      }

      const r2 = await postRespond({ acceptToken })
      console.log('POST accept (2nd idempotent)', r2.status, r2.json)
      if (r2.status !== 200 || !r2.json?.alreadyAccepted) {
        console.error('二次接受应返回 alreadyAccepted')
        process.exitCode = 1
      }

      const declineTok2 = tok('dcln2')
      await pool.query(
        `INSERT INTO appointment_participants
          (appointment_id, email, status, accept_token, decline_token)
         VALUES ($1, 'smoke_decline_glitchub@example.com', 'invited', $2, $3)`,
        [appointmentId, tok('acpt2'), declineTok2],
      )
      const r3 = await postRespond({ declineToken: declineTok2 })
      console.log('POST decline', r3.status, r3.json)
      if (r3.status !== 200 || r3.json?.action !== 'declined') {
        console.error('拒绝未成功')
        process.exitCode = 1
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
        console.warn(
          'HTTP 未测：无法连接',
          base,
          '。请先 npm run server:dev 后再运行本脚本。',
        )
      } else {
        console.error('HTTP 请求失败:', msg)
        process.exitCode = 1
      }
    }

    const chk = await pool.query(
      `SELECT status FROM appointment_participants WHERE id = $1`,
      [participantId],
    )
    if (chk.rows[0]?.status !== 'accepted') {
      console.error('DB 状态应为 accepted，实际:', chk.rows[0]?.status)
      process.exitCode = 1
    } else {
      console.log('DB 校验 participant 状态: accepted OK')
    }

    await pool.query(`DELETE FROM appointments WHERE id = $1`, [appointmentId])
    console.log('已清理测试 appointments 行。')

    if (httpOk) {
      console.log('test:appointment-invite 全部通过。')
    } else {
      console.log('DB 逻辑已校验；HTTP 请在启动 server 后重跑本脚本。')
    }
  } catch (e) {
    console.error(e)
    if (appointmentId) {
      await pool.query(`DELETE FROM appointments WHERE id = $1`, [appointmentId]).catch(() => {})
    }
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
