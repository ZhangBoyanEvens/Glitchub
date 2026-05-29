import { WebSocketServer } from 'ws'
import { verifyToken } from '@clerk/backend'
import { resolveUserPrimaryEmailLower } from './clerkUserEmail.js'
import { userMayAccessRoom } from './roomAccess.js'
import { getCachedAppointment } from './roomContext.js'

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const roomSockets = new Map()

/**
 * @param {string} roomId
 */
function roomKey(roomId) {
  return roomId.trim().toLowerCase()
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {object} payload
 */
function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

/**
 * @param {string} roomId
 * @param {object} payload
 */
export function broadcastRoomEvent(roomId, payload) {
  const set = roomSockets.get(roomKey(roomId))
  if (!set?.size) return
  const raw = JSON.stringify(payload)
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(raw)
  }
}

/**
 * @param {import('http').Server} httpServer
 * @param {import('pg').Pool | null} pool
 */
export function attachRoomSpinWebSocket(httpServer, pool) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/i)
    if (!match) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req, match[1])
    })
  })

  wss.on('connection', (ws, req, roomIdEncoded) => {
    void (async () => {
      if (!pool) {
        sendJson(ws, { eventType: 'ERROR', message: 'DATABASE_URL not configured' })
        ws.close()
        return
      }

      const roomId = decodeURIComponent(roomIdEncoded).trim()
      if (!roomId.toLowerCase().startsWith('rm_')) {
        sendJson(ws, { eventType: 'ERROR', message: 'Invalid room id' })
        ws.close()
        return
      }

      const token = urlToken(req)
      const userId = await verifyWsToken(token)
      if (!userId) {
        sendJson(ws, { eventType: 'ERROR', message: 'Unauthorized' })
        ws.close()
        return
      }

      const userEmail = await resolveUserPrimaryEmailLower(pool, userId)
      if (!userEmail) {
        sendJson(ws, { eventType: 'ERROR', message: 'NO_EMAIL' })
        ws.close()
        return
      }

      const appt = await getCachedAppointment(pool, roomId)
      if (!appt || appt.status === 'cancelled') {
        sendJson(ws, { eventType: 'ERROR', message: 'Room not found' })
        ws.close()
        return
      }

      const allowed = await userMayAccessRoom(pool, userId, userEmail, appt)
      if (!allowed) {
        sendJson(ws, { eventType: 'ERROR', message: 'Forbidden' })
        ws.close()
        return
      }

      const key = roomKey(roomId)
      let set = roomSockets.get(key)
      if (!set) {
        set = new Set()
        roomSockets.set(key, set)
      }
      set.add(ws)
      ws.__roomId = key
      ws.__userId = userId

      sendJson(ws, {
        eventType: 'CONNECTED',
        roomId: appt.room_id,
        serverTimestamp: Date.now(),
      })

      ws.on('close', () => {
        const s = roomSockets.get(key)
        if (s) {
          s.delete(ws)
          if (!s.size) roomSockets.delete(key)
        }
      })

      ws.on('error', () => {
        ws.close()
      })
    })()
  })

  return wss
}

/**
 * @param {import('http').IncomingMessage} req
 */
function urlToken(req) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  return url.searchParams.get('token')?.trim() ?? ''
}

/**
 * @param {string | null | undefined} token
 */
async function verifyWsToken(token) {
  if (!token || !process.env.CLERK_SECRET_KEY) return null
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    })
    return payload?.sub ?? null
  } catch {
    return null
  }
}
