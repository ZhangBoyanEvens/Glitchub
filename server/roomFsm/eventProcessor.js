import { hostMayEndRoom, isInstantAppointment } from '../roomAccess.js'
import { invalidatePrefix } from '../roomCache.js'
import { PRESENCE_TTL_SECONDS } from '../roomMembersData.js'
import { broadcastRoomEvent } from '../roomSpinHub.js'
import { deleteCancelledAppointmentRecord } from '../roomExpire.js'
import { finalizeSessionReputation } from '../reputation/reputationService.js'
import { ROOM_VETO_LIMIT, countUserVetoes, getUserCurrentVote } from '../roomGameSession.js'
import { EventType, buildDomainEvent } from './eventTypes.js'
import { fetchOnlineUserIds } from './roomDb.js'
import { checkRoomActionRateLimit, rateLimitKindForEventType } from './roomActionRateLimit.js'
import {
  allOnlinePlayersReady,
  appendEventLog,
  claimEventId,
  loadFsmContext,
  markGameStarted,
  newEventId,
  persistPhase,
  setPlayerReady,
} from './roomFsmPersistence.js'
import { RoomPhase, resolvePhaseFromAppointment } from './roomPhases.js'
import {
  canHostSpin,
  canMutateWishlist,
  canToggleReady,
  canUseVeto,
  transition,
} from './roomStateMachine.js'
import { createAuthoritativeSpin, spinRowToWsPayload, spinToWsPayload } from './spinEngine.js'

/**
 * @param {{ scheduled_at: Date | string, room_kind?: string | null }} appt
 */
export function hostMayStartGame(appt) {
  if (isInstantAppointment(appt)) return true
  const scheduledMs = new Date(appt.scheduled_at).getTime()
  return Number.isFinite(scheduledMs) && Date.now() >= scheduledMs
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ appt: import('pg').QueryResultRow, userId: string, isHost: boolean }} auth
 * @param {{ type: string, payload?: Record<string, unknown>, eventId?: string, timestamp?: number }} input
 */
export async function processRoomEvent(pool, auth, input) {
  const { appt, userId, isHost } = auth
  const ctx = await loadFsmContext(pool, appt.id)
  if (!ctx) {
    return { ok: false, code: 'NOT_FOUND', message: 'Room not found' }
  }

  let phase = ctx.phase
  if (phase === RoomPhase.CLOSED || appt.status === 'cancelled') {
    return { ok: false, code: 'ROOM_CLOSED', message: 'Room is closed' }
  }

  const event = buildDomainEvent({
    eventId: input.eventId ?? newEventId(),
    type: input.type,
    roomId: appt.room_id,
    timestamp: input.timestamp ?? Date.now(),
    userId,
    payload: input.payload ?? {},
  })

  const rateKind = rateLimitKindForEventType(event.type)
  if (rateKind) {
    const rl = checkRoomActionRateLimit(appt.room_id, userId, rateKind)
    if (!rl.ok) return rl
  }

  await maybeAdvanceSpinReveal(pool, ctx, appt)
  phase = (await loadFsmContext(pool, appt.id))?.phase ?? phase
  ctx.phase = phase

  const logBase = {
    ...event,
    appointmentId: appt.id,
  }

  const claimed = await claimEventId(pool, logBase, appt.id)
  if (!claimed) {
    const fresh = await loadFsmContext(pool, appt.id)
    return {
      ok: false,
      duplicate: true,
      code: 'DUPLICATE_EVENT',
      message: 'Event already processed',
      phase: fresh?.phase ?? phase,
      event,
    }
  }

  switch (event.type) {    case EventType.PLAYER_JOINED:
      return { ok: true, phase, event }

    case EventType.GAME_START_REQUESTED:      return processGameStart(pool, auth, ctx, event, logBase)

    case EventType.WISHLIST_UPDATED:
      return processWishlistUpdated(pool, auth, ctx, event, logBase)

    case EventType.PLAYER_READY_TOGGLED:
      return processReadyToggle(pool, auth, ctx, event, logBase)

    case EventType.SPIN_STARTED:
      return processSpinStarted(pool, auth, ctx, event, logBase)

    case EventType.VETO_USED:
      return processVetoUsed(pool, auth, ctx, event, logBase)

    case EventType.VETO_RESULT_RESOLVED:
    case EventType.GAME_FINALIZED:
      return processFinalize(pool, auth, ctx, event, logBase)

    case EventType.ROOM_CLOSED:
      return processRoomClosed(pool, auth, ctx, event, logBase)

    case EventType.SPIN_REVEALED:
      return processSpinRevealed(pool, auth, ctx, event, logBase)

    default:
      return { ok: false, code: 'UNKNOWN_EVENT', message: `Unknown event ${event.type}` }
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {object} ctx
 * @param {import('pg').QueryResultRow} appt
 */
async function maybeAdvanceSpinReveal(pool, ctx, appt) {
  if (ctx.phase !== RoomPhase.SPINNING || !ctx.activeSpin) return
  const revealAt = Number(ctx.activeSpin.reveal_timestamp_ms)
  if (!Number.isFinite(revealAt) || Date.now() < revealAt) return

  const tr = transition(RoomPhase.SPINNING, {
    type: EventType.SPIN_REVEALED,
    payload: {},
  })
  if (!tr.ok) return

  await persistPhase(pool, appt.id, appt.room_id, tr.phase)
  const ev = buildDomainEvent({
    eventId: newEventId(),
    type: EventType.SPIN_REVEALED,
    roomId: appt.room_id,
    userId: 'system',
    payload: { spinId: ctx.activeSpin.spin_id },
  })
  await appendEventLog(pool, { ...ev, appointmentId: appt.id })
  broadcastRoomState(appt.room_id, tr.phase, ctx.round)
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ appt: import('pg').QueryResultRow, userId: string, isHost: boolean }} auth
 * @param {Awaited<ReturnType<loadFsmContext>>} ctx
 * @param {ReturnType<buildDomainEvent>} event
 * @param {object} logBase
 */
const WISH_POOL_NONE_ID = 0

/**
 * @param {number} id
 */
function slotIdToDb(id) {
  return id === WISH_POOL_NONE_ID ? null : id
}

async function processWishlistUpdated(pool, auth, ctx, event, logBase) {
  const { appt } = auth
  if (!canMutateWishlist(ctx.phase, event.type)) {
    return invalid(ctx.phase, event.type)
  }

  const raw = event.payload.gameIds
  if (!Array.isArray(raw) || raw.length !== 3) {
    return { ok: false, code: 'BAD_REQUEST', message: 'gameIds must be [3] numbers' }
  }
  const gameIds = raw.map((x) => Number(x))
  if (gameIds.some((id) => !Number.isInteger(id) || id < 0)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'Invalid game id' }
  }

  const realIds = gameIds.filter((id) => id > 0)
  if (realIds.length) {
    const check = await pool.query(
      `SELECT id FROM reference_games WHERE id = ANY($1::int[])`,
      [realIds],
    )
    const found = new Set(check.rows.map((r) => r.id))
    if (realIds.some((id) => !found.has(id))) {
      return { ok: false, code: 'BAD_REQUEST', message: 'Unknown game id' }
    }
  }

  await pool.query(
    `INSERT INTO room_wish_pool
      (appointment_id, slot1_game_id, slot2_game_id, slot3_game_id, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (appointment_id)
     DO UPDATE SET
       slot1_game_id = EXCLUDED.slot1_game_id,
       slot2_game_id = EXCLUDED.slot2_game_id,
       slot3_game_id = EXCLUDED.slot3_game_id,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      appt.id,
      slotIdToDb(gameIds[0]),
      slotIdToDb(gameIds[1]),
      slotIdToDb(gameIds[2]),
      auth.userId,
    ],
  )

  broadcastRoomEvent(appt.room_id, {
    eventType: 'ROOM_WISHLIST_UPDATED',
    roomId: appt.room_id,
    gameIds,
    phase: ctx.phase,
  })
  return { ok: true, phase: ctx.phase, event, gameIds }
}

async function processGameStart(pool, auth, ctx, event, logBase) {
  const { appt, userId, isHost } = auth
  if (!isHost) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only the host can start the game' }
  }

  const payload = { ...event.payload }

  if (ctx.phase === RoomPhase.LOBBY) {
    if (!hostMayStartGame(appt)) {
      return {
        ok: false,
        code: 'GAME_START_TOO_EARLY',
        message: 'Scheduled time not reached',
        scheduledAt: appt.scheduled_at,
      }
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const locked = await client.query(`SELECT * FROM appointments WHERE id = $1 FOR UPDATE`, [
        appt.id,
      ])
      const row = locked.rows[0]
      if (!row) {
        await client.query('ROLLBACK')
        return { ok: false, code: 'NOT_FOUND', message: 'Room not found' }
      }

      const phase = resolvePhaseFromAppointment(row)
      if (phase !== RoomPhase.LOBBY) {
        await client.query('ROLLBACK')
        return invalid(phase, event.type)
      }

      const readyQ = await client.query(
        `SELECT clerk_user_id, is_ready FROM room_player_ready WHERE appointment_id = $1`,
        [appt.id],
      )
      const readyByUser = new Map(readyQ.rows.map((r) => [r.clerk_user_id, Boolean(r.is_ready)]))
      const onlineIds = await fetchOnlineUserIds(client, appt.id, PRESENCE_TTL_SECONDS)

      if (!allOnlinePlayersReady(onlineIds, readyByUser)) {
        await client.query('ROLLBACK')
        return {
          ok: false,
          code: 'NOT_ALL_READY',
          message: 'All online players must be ready',
        }
      }

      const tr = transition(phase, {
        type: EventType.GAME_START_REQUESTED,
        payload: { allPlayersReady: true },
      })
      if (!tr.ok) {
        await client.query('ROLLBACK')
        return tr
      }

      await markGameStarted(client, appt.id, userId)
      await client.query(
        `UPDATE appointments SET room_phase = $2, updated_at = now() WHERE id = $1`,
        [appt.id, tr.phase],
      )
      await client.query(`DELETE FROM room_player_ready WHERE appointment_id = $1`, [appt.id])
      await client.query('COMMIT')

      invalidatePrefix(`appt:${appt.room_id.trim().toLowerCase()}`)
      broadcastRoomState(appt.room_id, tr.phase, Number(row.room_round ?? 0))
      return { ok: true, phase: tr.phase, event }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  if (ctx.phase === RoomPhase.WISH_COLLECTION && payload.forceReadyLock === true) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const locked = await client.query(`SELECT * FROM appointments WHERE id = $1 FOR UPDATE`, [
        appt.id,
      ])
      const row = locked.rows[0]
      const phase = resolvePhaseFromAppointment(row)
      if (phase !== RoomPhase.WISH_COLLECTION) {
        await client.query('ROLLBACK')
        return invalid(phase, event.type)
      }

      const tr = transition(phase, {
        type: EventType.GAME_START_REQUESTED,
        payload: { forceReadyLock: true },
      })
      if (!tr.ok) {
        await client.query('ROLLBACK')
        return tr
      }

      await client.query(
        `UPDATE appointments SET room_phase = $2, updated_at = now() WHERE id = $1`,
        [appt.id, tr.phase],
      )
      await client.query('COMMIT')
      invalidatePrefix(`appt:${appt.room_id.trim().toLowerCase()}`)
      broadcastRoomState(appt.room_id, tr.phase, Number(row.room_round ?? 0))
      return { ok: true, phase: tr.phase, event }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  return invalid(ctx.phase, event.type)
}
async function processReadyToggle(pool, auth, ctx, event, logBase) {
  const { appt, userId } = auth
  if (!canToggleReady(ctx.phase)) {
    return invalid(ctx.phase, event.type)
  }

  const ready = Boolean(event.payload.ready)
  await setPlayerReady(pool, appt.id, userId, ready)

  const fresh = await loadFsmContext(pool, appt.id)
  if (!fresh) return { ok: false, code: 'NOT_FOUND', message: 'Room not found' }

  fresh.readyByUser.set(userId, ready)

  let phase = fresh.phase
  if (fresh.phase === RoomPhase.WISH_COLLECTION) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const locked = await client.query(`SELECT * FROM appointments WHERE id = $1 FOR UPDATE`, [
        appt.id,
      ])
      const row = locked.rows[0]
      const lockedPhase = resolvePhaseFromAppointment(row)
      if (lockedPhase === RoomPhase.WISH_COLLECTION) {
        const readyQ = await client.query(
          `SELECT clerk_user_id, is_ready FROM room_player_ready WHERE appointment_id = $1`,
          [appt.id],
        )
        const readyMap = new Map(readyQ.rows.map((r) => [r.clerk_user_id, Boolean(r.is_ready)]))
        readyMap.set(userId, ready)
        const onlineIds = await fetchOnlineUserIds(client, appt.id, PRESENCE_TTL_SECONDS)
        if (allOnlinePlayersReady(onlineIds, readyMap)) {
          const tr = transition(lockedPhase, {
            type: EventType.GAME_START_REQUESTED,
            payload: { allPlayersReady: true },
          })
          if (tr.ok) {
            await client.query(
              `UPDATE appointments SET room_phase = $2, updated_at = now() WHERE id = $1`,
              [appt.id, tr.phase],
            )
            phase = tr.phase
          }
        }
      }
      await client.query('COMMIT')
      if (phase !== fresh.phase) {
        invalidatePrefix(`appt:${appt.room_id.trim().toLowerCase()}`)
        broadcastRoomState(appt.room_id, phase, fresh.round)
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  broadcastRoomEvent(appt.room_id, {
    eventType: 'ROOM_PLAYER_READY',
    roomId: appt.room_id,
    clerkUserId: userId,
    ready,
    phase,
  })

  return { ok: true, phase, event, ready }
}

async function processSpinStarted(pool, auth, ctx, event, logBase) {
  const { appt, userId, isHost } = auth
  if (!isHost) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only the host can spin' }
  }
  if (!canHostSpin(ctx.phase)) {
    return invalid(ctx.phase, event.type)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(`SELECT * FROM appointments WHERE id = $1 FOR UPDATE`, [
      appt.id,
    ])
    const row = locked.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return { ok: false, code: 'NOT_FOUND', message: 'Room not found' }
    }

    const phase = resolvePhaseFromAppointment(row)
    if (!canHostSpin(phase)) {
      await client.query('ROLLBACK')
      return invalid(phase, event.type)
    }

    const activeQ = await client.query(
      `SELECT COUNT(*)::int AS n FROM room_spins
       WHERE appointment_id = $1 AND invalidated_at IS NULL`,
      [appt.id],
    )
    const activeN = activeQ.rows[0]?.n ?? 0
    if (phase !== RoomPhase.RESPINNING && (activeN > 0 || row.active_spin_id)) {
      await client.query('ROLLBACK')
      return {
        ok: false,
        code: 'SPIN_ALREADY_ACTIVE',
        message: 'Only one active spin allowed per room',
        phase,
      }
    }

    const spinRes = await executeSpinInTransaction(
      client,
      { appt, userId },
      phase,
      Number(row.room_round ?? 0),
    )
    if (!spinRes.ok) {
      await client.query('ROLLBACK')
      return spinRes
    }

    await client.query('COMMIT')
    invalidatePrefix(`appt:${appt.room_id.trim().toLowerCase()}`)

    broadcastRoomEvent(row.room_id, spinRes.spin)
    broadcastRoomState(row.room_id, spinRes.phase, spinRes.round, { activeSpin: spinRes.spin })

    return { ok: true, phase: spinRes.phase, event, spin: spinRes.spin }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function processSpinRevealed(pool, auth, ctx, event, logBase) {
  const { appt } = auth
  if (ctx.phase !== RoomPhase.SPINNING) {
    return invalid(ctx.phase, event.type)
  }
  const tr = transition(ctx.phase, { type: EventType.SPIN_REVEALED, payload: {} })
  if (!tr.ok) return tr
  await persistPhase(pool, appt.id, appt.room_id, tr.phase)
  broadcastRoomState(appt.room_id, tr.phase, ctx.round)
  return { ok: true, phase: tr.phase, event }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ appt: import('pg').QueryResultRow, userId: string }} auth
 * @param {string} phase
 * @param {number} round
 */
async function executeSpinInTransaction(client, auth, phase, round) {
  const { appt, userId } = auth
  const tr = transition(phase, { type: EventType.SPIN_STARTED, payload: {} })
  if (!tr.ok) return tr

  let nextRound = round
  if (phase === RoomPhase.RESPINNING) {
    await client.query(
      `UPDATE room_spins SET invalidated_at = now()
       WHERE appointment_id = $1 AND invalidated_at IS NULL`,
      [appt.id],
    )
    await client.query(`DELETE FROM room_game_votes WHERE appointment_id = $1`, [appt.id])
    nextRound += 1
  }

  const spin = await createAuthoritativeSpin(client, appt.id, nextRound)
  spin.roomId = appt.room_id

  await client.query(
    `INSERT INTO room_spins (
       spin_id, appointment_id, room_id, host_clerk_user_id,
       seed, result_game_id, result_game_title, tier_rank,
       spin_duration_ms, server_timestamp_ms, reveal_timestamp_ms, round_number
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      spin.spinId,
      appt.id,
      appt.room_id,
      userId,
      spin.seed,
      spin.resultGameId,
      spin.resultGameTitle,
      spin.tierRank,
      spin.spinDuration,
      spin.serverTimestamp,
      spin.revealTimestamp,
      nextRound,
    ],
  )

  await client.query(
    `INSERT INTO room_case_draw_logs
      (appointment_id, clerk_user_id, game_id, game_title, tier_rank)
     VALUES ($1, $2, $3, $4, $5)`,
    [appt.id, userId, spin.resultGameId, spin.resultGameTitle, Math.round(spin.tierRank)],
  )

  await client.query(
    `UPDATE appointments
     SET room_phase = $2, room_round = $3, active_spin_id = $4, updated_at = now()
     WHERE id = $1`,
    [appt.id, tr.phase, nextRound, spin.spinId],
  )

  return { ok: true, phase: tr.phase, round: nextRound, spin: spinToWsPayload(spin) }
}

async function processVetoUsed(pool, auth, ctx, event, logBase) {
  const { appt, userId } = auth
  if (!canUseVeto(ctx.phase)) {
    return invalid(ctx.phase, event.type)
  }

  const vote = String(event.payload.vote ?? '').toLowerCase()
  const gameTitle = String(event.payload.gameTitle ?? '').trim()
  if (vote !== 'approve' && vote !== 'reject') {
    return { ok: false, code: 'BAD_REQUEST', message: 'vote must be approve or reject' }
  }

  const client = await pool.connect()
  /** @type {{ ok: boolean, phase: string, round: number, spin?: object, vetoOutcome?: string, vote?: string, gameTitle?: string | null, code?: string, message?: string, vetoUsed?: number, vetoLimit?: number }} */
  let result = { ok: true, phase: ctx.phase, round: ctx.round }

  try {
    await client.query('BEGIN')
    const locked = await client.query(`SELECT * FROM appointments WHERE id = $1 FOR UPDATE`, [
      appt.id,
    ])
    const row = locked.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return { ok: false, code: 'NOT_FOUND', message: 'Room not found' }
    }

    const phase = resolvePhaseFromAppointment(row)
    if (!canUseVeto(phase)) {
      await client.query('ROLLBACK')
      return invalid(phase, event.type)
    }

    if (phase === RoomPhase.FINALIZED || phase === RoomPhase.CLOSED) {
      await client.query('ROLLBACK')
      return invalid(phase, event.type)
    }

    if (vote === 'reject') {
      const prevVote = await getUserCurrentVote(client, appt.id, userId)
      if (prevVote !== 'reject') {
        const used = await countUserVetoes(client, appt.id, userId)
        if (used >= ROOM_VETO_LIMIT) {
          await client.query('ROLLBACK')
          return {
            ok: false,
            code: 'VETO_LIMIT_REACHED',
            message: 'VETO_LIMIT_REACHED',
            vetoUsed: used,
            vetoLimit: ROOM_VETO_LIMIT,
          }
        }
        await client.query(
          `INSERT INTO room_game_vetoes (appointment_id, clerk_user_id, game_title, reject_count)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (appointment_id, clerk_user_id)
           DO UPDATE SET
             reject_count = room_game_vetoes.reject_count + 1,
             game_title = EXCLUDED.game_title,
             created_at = now()`,
          [appt.id, userId, gameTitle || null],
        )
      }
    }

    await client.query(
      `INSERT INTO room_game_votes
        (appointment_id, clerk_user_id, vote, game_title)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (appointment_id, clerk_user_id)
       DO UPDATE SET vote = EXCLUDED.vote, game_title = EXCLUDED.game_title, updated_at = now()`,
      [appt.id, userId, vote, gameTitle || null],
    )

    const outcome = await evaluateVetoOutcome(client, appt, gameTitle)
    const round = Number(row.room_round ?? 0)
    let nextPhase = phase
    let wsSpin = null
    let finalExtras = null

    if (outcome === 'finalized') {
      const tr = transition(phase, {
        type: EventType.VETO_RESULT_RESOLVED,
        payload: { outcome: 'finalized' },
      })
      if (tr.ok) {
        const spinQ = await client.query(
          `SELECT result_game_id, result_game_title FROM room_spins
           WHERE appointment_id = $1 AND invalidated_at IS NULL
           ORDER BY server_timestamp_ms DESC LIMIT 1`,
          [appt.id],
        )
        const spinRow = spinQ.rows[0]
        const finalGameId = spinRow ? Number(spinRow.result_game_id) : null
        const finalGameTitle = spinRow?.result_game_title ?? gameTitle
        await client.query(
          `UPDATE appointments
           SET room_phase = $2, final_game_id = $3, final_game_title = $4, updated_at = now()
           WHERE id = $1`,
          [appt.id, tr.phase, finalGameId, finalGameTitle],
        )
        nextPhase = tr.phase
        finalExtras = { finalGameId, finalGameTitle }
      }
    } else if (outcome === 'respun') {
      const tr = transition(phase, {
        type: EventType.VETO_RESULT_RESOLVED,
        payload: { outcome: 'respun' },
      })
      if (tr.ok) {
        await client.query(
          `UPDATE appointments
           SET room_phase = $2, active_spin_id = NULL, updated_at = now()
           WHERE id = $1`,
          [appt.id, tr.phase],
        )
        nextPhase = tr.phase

        const spinEvent = buildDomainEvent({
          eventId: newEventId(),
          type: EventType.SPIN_STARTED,
          roomId: appt.room_id,
          timestamp: Date.now(),
          userId: appt.host_id,
          payload: { autoRespin: true },
        })
        const spinClaimed = await claimEventId(
          client,
          { ...spinEvent, appointmentId: appt.id },
          appt.id,
        )
        if (!spinClaimed) {
          await client.query('ROLLBACK')
          const fresh = await loadFsmContext(pool, appt.id)
          return {
            ok: false,
            duplicate: true,
            code: 'DUPLICATE_EVENT',
            message: 'Event already processed',
            phase: fresh?.phase ?? phase,
            event,
          }
        }

        const spinRes = await executeSpinInTransaction(
          client,
          { appt, userId: appt.host_id },
          tr.phase,
          round,
        )
        if (!spinRes.ok) {
          await client.query('ROLLBACK')
          return spinRes
        }
        nextPhase = spinRes.phase
        wsSpin = spinRes.spin
        result.round = spinRes.round
      }
    }

    await client.query('COMMIT')
    invalidatePrefix(`appt:${appt.room_id.trim().toLowerCase()}`)

    if (finalExtras) {
      try {
        await finalizeSessionReputation(pool, appt)
      } catch (repErr) {
        console.warn('[roomFsm] reputation finalize failed', repErr?.message ?? repErr)
      }
      broadcastRoomState(appt.room_id, nextPhase, round, finalExtras)
    } else if (wsSpin) {
      broadcastRoomEvent(appt.room_id, wsSpin)
      broadcastRoomState(appt.room_id, nextPhase, result.round, { activeSpin: wsSpin })
    }

    result = {
      ok: true,
      phase: nextPhase,
      round: result.round,
      event,
      vetoOutcome: outcome,
      vote,
      gameTitle: gameTitle || null,
      ...(wsSpin ? { spin: wsSpin } : {}),
    }
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {import('pg').QueryResultRow} appt
 * @param {string} gameTitle
 * @returns {Promise<'pending' | 'finalized' | 'respun'>}
 */
async function evaluateVetoOutcome(db, appt, gameTitle) {
  const title = gameTitle.trim()
  if (!title) return 'pending'

  const onlineIds = await fetchOnlineUserIds(db, appt.id, PRESENCE_TTL_SECONDS)
  if (!onlineIds.length) return 'pending'

  const votesQ = await db.query(
    `SELECT clerk_user_id, vote, game_title FROM room_game_votes WHERE appointment_id = $1`,
    [appt.id],
  )
  const votesForTitle = votesQ.rows.filter(
    (r) => String(r.game_title ?? '').trim() === title,
  )

  let rejectCount = 0
  let approveCount = 0
  for (const uid of onlineIds) {
    const row = votesForTitle.find((v) => v.clerk_user_id === uid)
    if (!row) return 'pending'
    if (row.vote === 'reject') rejectCount++
    else if (row.vote === 'approve') approveCount++
    else return 'pending'
  }

  if (rejectCount > 0) return 'respun'
  if (approveCount === onlineIds.length) return 'finalized'
  return 'pending'
}

async function processFinalize(pool, auth, ctx, event, logBase) {
  const { appt, isHost } = auth
  if (ctx.phase !== RoomPhase.VETO_PHASE && ctx.phase !== RoomPhase.FINALIZED) {
    return invalid(ctx.phase, event.type)
  }
  if (!isHost && event.type === EventType.GAME_FINALIZED) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only host can force finalize' }
  }

  const gameTitle = String(event.payload.gameTitle ?? ctx.activeSpin?.result_game_title ?? '')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(`SELECT * FROM appointments WHERE id = $1 FOR UPDATE`, [
      appt.id,
    ])
    const row = locked.rows[0]
    const phase = resolvePhaseFromAppointment(row)

    if (phase === RoomPhase.FINALIZED) {
      await client.query('ROLLBACK')
      return { ok: true, phase: RoomPhase.FINALIZED, event, noop: true }
    }
    if (phase !== RoomPhase.VETO_PHASE) {
      await client.query('ROLLBACK')
      return invalid(phase, event.type)
    }

    const outcome = await evaluateVetoOutcome(client, appt, gameTitle)
    if (outcome !== 'finalized') {
      await client.query('ROLLBACK')
      return { ok: false, code: 'NOT_READY', message: 'Consensus not reached' }
    }

    const tr = transition(RoomPhase.VETO_PHASE, {
      type: EventType.GAME_FINALIZED,
      payload: {},
    })
    if (!tr.ok) {
      await client.query('ROLLBACK')
      return tr
    }

    const spinQ = await client.query(
      `SELECT result_game_id, result_game_title FROM room_spins
       WHERE appointment_id = $1 AND invalidated_at IS NULL
       ORDER BY server_timestamp_ms DESC LIMIT 1`,
      [appt.id],
    )
    const spinRow = spinQ.rows[0]
    const finalGameId = spinRow ? Number(spinRow.result_game_id) : null
    const finalGameTitle = spinRow?.result_game_title ?? gameTitle

    await client.query(
      `UPDATE appointments
       SET room_phase = $2, final_game_id = $3, final_game_title = $4, updated_at = now()
       WHERE id = $1`,
      [appt.id, tr.phase, finalGameId, finalGameTitle],
    )
    await client.query('COMMIT')
    invalidatePrefix(`appt:${appt.room_id.trim().toLowerCase()}`)

    try {
      await finalizeSessionReputation(pool, appt)
    } catch (repErr) {
      console.warn('[roomFsm] reputation finalize failed', repErr?.message ?? repErr)
    }
    broadcastRoomState(appt.room_id, tr.phase, Number(row.room_round ?? 0), {
      finalGameId,
      finalGameTitle,
    })
    return { ok: true, phase: tr.phase, event }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function processRoomClosed(pool, auth, ctx, event, logBase) {
  const { appt, isHost } = auth
  if (!isHost) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only the host can end the room' }
  }
  if (!hostMayEndRoom(appt)) {
    return {
      ok: false,
      code: 'ROOM_END_BEFORE_SCHEDULED',
      message: 'ROOM_END_BEFORE_SCHEDULED',
      scheduledAt: appt.scheduled_at,
    }
  }

  if (ctx.phase !== RoomPhase.FINALIZED && ctx.phase !== RoomPhase.LOBBY) {
    const tr = transition(ctx.phase, { type: EventType.ROOM_CLOSED, payload: {} })
    if (!tr.ok && ctx.phase !== RoomPhase.WISH_COLLECTION) {
      /* 允许从任意进行中阶段强制结束房间 */
    }
  }

  await pool.query(
    `UPDATE appointments SET status = 'cancelled', room_phase = $2, updated_at = now() WHERE id = $1`,
    [appt.id, RoomPhase.CLOSED],
  )
  try {
    await finalizeSessionReputation(pool, appt)
  } catch (repErr) {
    console.warn('[roomFsm] reputation finalize failed', repErr?.message ?? repErr)
  }
  await deleteCancelledAppointmentRecord(pool, appt)
  broadcastRoomState(appt.room_id, RoomPhase.CLOSED, ctx.round)
  return { ok: true, phase: RoomPhase.CLOSED, event, deleted: true }
}

/**
 * @param {string} roomId
 * @param {string} phase
 * @param {number} round
 * @param {Record<string, unknown>} [extra]
 */
export function broadcastRoomState(roomId, phase, round, extra = {}) {
  broadcastRoomEvent(roomId, {
    eventType: 'ROOM_STATE_CHANGED',
    roomId,
    phase,
    round,
    serverTimestamp: Date.now(),
    ...extra,
  })
}

/**
 * @param {import('pg').Pool} pool
 * @param {import('pg').QueryResultRow} appt
 */
export async function syncFsmOnRead(pool, appt) {
  const ctx = await loadFsmContext(pool, appt.id)
  if (!ctx) return null
  await maybeAdvanceSpinReveal(pool, ctx, appt)
  return loadFsmContext(pool, appt.id)
}

function invalid(phase, type) {
  return {
    ok: false,
    code: 'INVALID_TRANSITION',
    message: `Cannot apply ${type} in phase ${phase}`,
    phase,
  }
}

export { spinRowToWsPayload }
