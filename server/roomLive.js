import {
  resolveAuthorizedRoomContext,
  sendRoomContextError,
} from './roomContext.js'
import { fetchRoomMembersFast } from './roomMembersData.js'
import { ROOM_VETO_LIMIT, countUserVetoes } from './roomGameSession.js'
import { buildFsmLiveExtras } from './roomFsm/roomService.js'
import { RoomPhase } from './roomFsm/roomPhases.js'
import { buildGameSessionResponse } from './roomAccess.js'
import { computeRoomReadiness } from './roomFsm/readiness.js'
import { getReputationForUsers } from './reputation/reputationService.js'
import { loadFsmContext } from './roomFsm/roomFsmPersistence.js'

const WISH_POOL_NONE_ID = 0

/**
 * @param {import('pg').Pool} pool
 * @param {(number|null)[]} rawSlotIds
 */
async function loadWishPoolSlots(pool, rawSlotIds) {
  const gameIds = rawSlotIds.map((id) =>
    id == null || Number(id) === 0 ? WISH_POOL_NONE_ID : Number(id),
  )
  const realIds = gameIds.filter((id) => id > 0)
  if (!realIds.length) {
    return { gameIds, games: gameIds.map((id) => ({ id, title: id === 0 ? 'None' : String(id) })) }
  }
  const { rows } = await pool.query(
    `SELECT id, title FROM reference_games WHERE id = ANY($1::int[])`,
    [realIds],
  )
  const byId = new Map(rows.map((r) => [r.id, r.title]))
  return {
    gameIds,
    games: gameIds.map((id) => ({
      id,
      title: id === 0 ? 'None' : byId.get(id) ?? `Game #${id}`,
    })),
  }
}

/**
 * GET /api/rooms/:roomId/live — 房间内单次往返：成员 + 对局 + 投票 + 许愿池
 */
export function registerRoomLiveRoutes(app, pool) {
  app.get('/api/rooms/:roomId/live', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const roomId = decodeURIComponent(String(req.params.roomId ?? '')).trim()
    if (!roomId || !roomId.toLowerCase().startsWith('rm_')) {
      res.status(400).json({ ok: false, message: 'Invalid room id (expected rm_…)' })
      return
    }

    const ctx = await resolveAuthorizedRoomContext(pool, req, roomId)
    if (!ctx.ok) {
      sendRoomContextError(res, ctx)
      return
    }

    const { userId, appt } = ctx
    const fsm = await buildFsmLiveExtras(pool, { appt, userId })
    const phase = fsm.roomPhase
    const started = phase !== RoomPhase.LOBBY && phase !== RoomPhase.CLOSED

    try {
      const membersP = fetchRoomMembersFast(pool, appt)
      const votesP = pool
        .query(
          `SELECT clerk_user_id, vote, game_title, updated_at
           FROM room_game_votes WHERE appointment_id = $1`,
          [appt.id],
        )
        .catch((err) => {
          if (err && String(err.code) === '42P01') return { rows: [] }
          throw err
        })
      const wishP = pool
        .query(
          `SELECT slot1_game_id, slot2_game_id, slot3_game_id
           FROM room_wish_pool WHERE appointment_id = $1`,
          [appt.id],
        )
        .catch((err) => {
          if (err && String(err.code) === '42P01') return { rows: [] }
          throw err
        })
      const vetoP = started
        ? countUserVetoes(pool, appt.id, userId).catch((err) => {
            if (err && String(err.code) === '42P01') return 0
            throw err
          })
        : Promise.resolve(0)

      const [members, votesQ, wishQ, vetoUsed, fsmCtx] = await Promise.all([
        membersP,
        votesP,
        wishP,
        vetoP,
        loadFsmContext(pool, appt.id),
      ])

      const readyByUser = fsmCtx?.readyByUser ?? new Map()
      const readiness = computeRoomReadiness(members, readyByUser)
      const memberIds = members.map((m) => m.clerkUserId).filter(Boolean)
      const reputationByUserId = await getReputationForUsers(pool, memberIds)
      const membersWithMeta = members.map((m) => ({
        ...m,
        ready: m.clerkUserId ? readyByUser.get(m.clerkUserId) === true : false,
        reputation: m.clerkUserId ? reputationByUserId[m.clerkUserId] ?? null : null,
      }))

      const wishRow = wishQ.rows[0]
      const wishPool = wishRow
        ? await loadWishPoolSlots(pool, [
            wishRow.slot1_game_id,
            wishRow.slot2_game_id,
            wishRow.slot3_game_id,
          ])
        : { gameIds: [0, 0, 0], games: [] }

      const wishSubmittedCount = wishRow
        ? [wishRow.slot1_game_id, wishRow.slot2_game_id, wishRow.slot3_game_id].filter(
            (id) => id != null,
          ).length
        : 0
      const onlineVotable = members.filter((m) => m.isOnline && m.clerkUserId)
      const votedCount = new Set(
        votesQ.rows
          .map((r) => r.clerk_user_id)
          .filter((id) => onlineVotable.some((m) => m.clerkUserId === id)),
      ).size

      res.json({
        ...buildGameSessionResponse(appt, userId, {
          started,
          vetoUsed,
          vetoLimit: ROOM_VETO_LIMIT,
          roomPhase: phase,
          roomRound: fsm.roomRound,
          playerReady: fsm.playerReady,
          activeSpin: fsm.activeSpin,
          finalGame: fsm.finalGameId
            ? { id: fsm.finalGameId, title: fsm.finalGameTitle }
            : null,
        }),
        readiness: {
          onlineMembers: readiness.onlineMembers,
          readyMembers: readiness.readyMembers,
          allReady: readiness.allReady,
          onlineCount: readiness.onlineCount,
          readyCount: readiness.readyCount,
        },
        progress: {
          ready: `${readiness.readyCount} / ${readiness.onlineCount} players ready`,
          wishPool: `${wishSubmittedCount} / ${onlineVotable.length || members.length} submitted`,
          voting: `${votedCount} / ${onlineVotable.length || members.length} voted`,
        },
        members: membersWithMeta,
        votes: votesQ.rows.map((r) => ({
          clerkUserId: r.clerk_user_id,
          vote: r.vote,
          gameTitle: r.game_title ?? null,
          updatedAt: r.updated_at,
        })),
        wishPool,
        serverTime: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[rooms/live GET]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
