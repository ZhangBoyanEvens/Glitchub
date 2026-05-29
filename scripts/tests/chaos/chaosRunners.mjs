import { syncFsmOnRead } from '../../../server/roomFsm/eventProcessor.js'
import { EventType } from '../../../server/roomFsm/eventTypes.js'
import { RoomPhase } from '../../../server/roomFsm/roomPhases.js'
import { compareLiveVsReplay } from './replayRunner.mjs'
import {
  captureSnapshot,
  cleanupChaosRoom,
  deliverShuffled,
  dispatch,
  ensureAllPresence,
  fastForwardSpinReveal,
  lobbyReadyAndStart,
  randomLatency,
  seedChaosRoom,
  sleep,
  snapshotKey,
} from './chaosHarness.mjs'

/**
 * A. Stress smoke — 10–20 用户，多轮完整周期 + 阶段内 spam
 */
export async function runStressSmoke(pool, metrics, rng, opts) {
  const userCount = opts.userCount
  const cycles = opts.cycles
  const prefix = opts.prefix
  const spamRounds = opts.spamRounds ?? 3
  let allPass = true

  for (let c = 0; c < cycles; c++) {
    console.log(`    stress cycle ${c + 1}/${cycles} …`)
    const tag = `${prefix}_stress_c${c}`
    const { appt, users, gameIds, host } = await seedChaosRoom(pool, tag, userCount)
    const userIds = users.map((u) => u.id)

    try {
      let before = await captureSnapshot(pool, appt.id)
      let r = await lobbyReadyAndStart(pool, appt, users)
      metrics.recordEvent(before, await captureSnapshot(pool, appt.id), r)

      const spamTasks = []
      for (const u of users) {
        for (let k = 0; k < spamRounds; k++) {
          spamTasks.push(async () => {
            await ensureAllPresence(pool, appt.id, userIds)
            const b = await captureSnapshot(pool, appt.id)
            const res = await dispatch(pool, appt, u, EventType.WISHLIST_UPDATED, { gameIds })
            metrics.recordEvent(b, await captureSnapshot(pool, appt.id), res)
          })
          spamTasks.push(async () => {
            await ensureAllPresence(pool, appt.id, userIds)
            const b = await captureSnapshot(pool, appt.id)
            const res = await dispatch(pool, appt, u, EventType.PLAYER_READY_TOGGLED, {
              ready: rng() > 0.3,
            })
            metrics.recordEvent(b, await captureSnapshot(pool, appt.id), res)
          })
          if (!u.isHost) {
            spamTasks.push(async () => {
              const b = await captureSnapshot(pool, appt.id)
              const res = await dispatch(pool, appt, u, EventType.SPIN_STARTED)
              metrics.recordEvent(b, await captureSnapshot(pool, appt.id), res)
            })
          }
        }
      }
      const { dropped } = await deliverShuffled(spamTasks, rng, { dropRate: 0.05 })
      metrics.droppedEvents += dropped

      await ensureAllPresence(pool, appt.id, userIds)
      for (const u of users) {
        before = await captureSnapshot(pool, appt.id)
        r = await dispatch(pool, appt, u, EventType.PLAYER_READY_TOGGLED, { ready: true })
        metrics.recordEvent(before, await captureSnapshot(pool, appt.id), r)
      }

      let snap = await metrics.assertInvariants(pool, appt.id, `stress-c${c}-pre-lock`)
      if (snap?.phase === RoomPhase.WISH_COLLECTION) {
        before = snap
        r = await dispatch(pool, appt, host, EventType.GAME_START_REQUESTED, {
          forceReadyLock: true,
        })
        metrics.recordEvent(before, await captureSnapshot(pool, appt.id), r)
      }

      before = await captureSnapshot(pool, appt.id)
      r = await dispatch(pool, appt, host, EventType.SPIN_STARTED)
      metrics.recordEvent(before, await captureSnapshot(pool, appt.id), r)

      await fastForwardSpinReveal(pool, appt.id)
      snap = await metrics.assertInvariants(pool, appt.id, `stress-c${c}-post-spin`)

      const title = snap?.activeSpinTitle ?? ''
      if (snap?.phase === RoomPhase.VETO_PHASE && title) {
        for (const u of users) {
          before = await captureSnapshot(pool, appt.id)
          r = await dispatch(pool, appt, u, EventType.VETO_USED, {
            vote: 'approve',
            gameTitle: title,
          })
          metrics.recordEvent(before, await captureSnapshot(pool, appt.id), r)
        }
      }

      snap = await captureSnapshot(pool, appt.id)
      if (snap?.phase !== RoomPhase.FINALIZED && snap?.phase !== RoomPhase.CLOSED) {
        const stuck = await tryUnstick(pool, appt, host, users, gameIds, title)
        if (!stuck) {
          metrics.failCritical('ROOM_STUCK', `cycle ${c} phase=${snap?.phase}`)
          allPass = false
        }
      }

      before = await captureSnapshot(pool, appt.id)
      if (before?.phase === RoomPhase.FINALIZED) {
        r = await dispatch(pool, appt, host, EventType.ROOM_CLOSED)
        metrics.recordEvent(before, await captureSnapshot(pool, appt.id), r)
      }

      snap = await metrics.assertInvariants(pool, appt.id, `stress-c${c}-end`)
      if (snap && snap.activeSpinCount > 1) allPass = false
    } finally {
      await cleanupChaosRoom(pool, appt.id, userIds)
    }
  }

  metrics.setCategory('A. Stress Smoke', allPass && !metrics.criticalFailures.length)
  return allPass
}

async function tryUnstick(pool, appt, host, users, gameIds, title) {
  let snap = await captureSnapshot(pool, appt.id)
  if (snap?.phase === RoomPhase.VETO_PHASE && title) {
    for (const u of users) {
      await dispatch(pool, appt, u, EventType.VETO_USED, { vote: 'approve', gameTitle: title })
    }
    snap = await captureSnapshot(pool, appt.id)
  }
  if (snap?.phase === RoomPhase.FINALIZED) return true
  if (snap?.phase === RoomPhase.SPINNING) {
    await fastForwardSpinReveal(pool, appt.id)
    return true
  }
  return snap?.phase === RoomPhase.FINALIZED || snap?.phase === RoomPhase.CLOSED
}

/**
 * B. Chaos event ordering
 */
export async function runChaosOrdering(pool, metrics, rng, opts) {
  const { appt, users, gameIds, host } = await seedChaosRoom(pool, `${opts.prefix}_order`, opts.userCount)
  const userIds = users.map((u) => u.id)
  let pass = true

  try {
    await lobbyReadyAndStart(pool, appt, users)
    await ensureAllPresence(pool, appt.id, userIds)

    const title = 'chaos-placeholder'
    const malicious = [
      () =>
        dispatch(pool, appt, users[1], EventType.VETO_USED, {
          vote: 'reject',
          gameTitle: title,
        }),
      () => dispatch(pool, appt, host, EventType.SPIN_STARTED),
      () =>
        dispatch(pool, appt, users[2], EventType.PLAYER_READY_TOGGLED, { ready: true }),
      () =>
        dispatch(pool, appt, users[0], EventType.WISHLIST_UPDATED, { gameIds }),
      () =>
        dispatch(pool, appt, host, EventType.GAME_START_REQUESTED, { forceReadyLock: true }),
      () => dispatch(pool, appt, host, EventType.SPIN_STARTED),
      () =>
        dispatch(pool, appt, users[3], EventType.VETO_USED, {
          vote: 'approve',
          gameTitle: title,
        }),
    ]

    const wrapped = malicious.map((fn) => async () => {
      const b = await captureSnapshot(pool, appt.id)
      const res = await fn()
      metrics.recordEvent(b, await captureSnapshot(pool, appt.id), res)
      if (!res?.ok && res?.code !== 'INVALID_TRANSITION' && res?.code !== 'NOT_ALL_READY' && res?.code !== 'DUPLICATE_EVENT') {
        pass = false
      }
    })

    const { dropped } = await deliverShuffled(wrapped, rng, { dropRate: 0.1 })
    metrics.droppedEvents += dropped

    const snap = await metrics.assertInvariants(pool, appt.id, 'chaos-ordering')
    if (!snap || !ALL_PHASES_SAFE.has(snap.phase)) {
      metrics.failCritical('UNDEFINED_PHASE', snap?.phase)
      pass = false
    }

    const invalidRate = metrics.invalidTransitions / Math.max(1, metrics.totalEvents)
    if (invalidRate < 0.05) {
      logWarn('ordering: few invalid transitions — shuffle may be too weak')
    }
  } finally {
    await cleanupChaosRoom(pool, appt.id, userIds)
  }

  metrics.setCategory('B. Chaos Ordering', pass)
  return pass
}

const ALL_PHASES_SAFE = new Set(Object.values(RoomPhase))

function logWarn(msg) {
  console.warn(`  [warn] ${msg}`)
}

/**
 * C. Concurrency attack
 */
export async function runConcurrencyAttack(pool, metrics, rng, opts) {
  const { appt, users, gameIds, host } = await seedChaosRoom(
    pool,
    `${opts.prefix}_conc`,
    opts.userCount,
  )
  const userIds = users.map((u) => u.id)
  let pass = true

  try {
    await lobbyReadyAndStart(pool, appt, users)
    for (const u of users) {
      await dispatch(pool, appt, u, EventType.WISHLIST_UPDATED, { gameIds })
      await dispatch(pool, appt, u, EventType.PLAYER_READY_TOGGLED, { ready: true })
    }
    await dispatch(pool, appt, host, EventType.GAME_START_REQUESTED, { forceReadyLock: true })

    const spinAtOnce = users.slice(0, 5).map((u) => async () => {
      const b = await captureSnapshot(pool, appt.id)
      const res = await dispatch(pool, appt, u.isHost ? u : host, EventType.SPIN_STARTED)
      if (res?.ok) metrics.concurrentSpinSuccesses++
      metrics.recordEvent(b, await captureSnapshot(pool, appt.id), res)
      return res
    })

    const spinResults = await Promise.all(spinAtOnce.map((fn) => fn()))
    const spinWins = spinResults.filter((r) => r?.ok && r?.spin).length
    if (spinWins > 1) {
      metrics.raceConditionsDetected++
      metrics.failCritical('CONCURRENT_SPIN_RACE', `${spinWins} spins succeeded`)
      pass = false
    }

    let snap = await metrics.assertInvariants(pool, appt.id, 'after-concurrent-spin')
    await fastForwardSpinReveal(pool, appt.id)
    snap = await captureSnapshot(pool, appt.id)

    if (snap?.phase === RoomPhase.VETO_PHASE) {
      const title = snap.activeSpinTitle ?? ''
      const vetoAtOnce = users.map((u) => async () => {
        const b = await captureSnapshot(pool, appt.id)
        await ensureAllPresence(pool, appt.id, userIds)
        return dispatch(pool, appt, u, EventType.VETO_USED, {
          vote: u.id.endsWith('_u2') ? 'reject' : 'approve',
          gameTitle: title,
        })
      })
      const vetoResults = await Promise.all(vetoAtOnce.map((fn) => fn()))
      for (const res of vetoResults) {
        metrics.recordEvent(snap, await captureSnapshot(pool, appt.id), res)
      }
    }

    snap = await metrics.assertInvariants(pool, appt.id, 'after-concurrent-veto')
    if (snap && snap.activeSpinCount > 1) {
      metrics.failCritical('MULTIPLE_ACTIVE_SPINS', 'post-veto')
      pass = false
    }

    const startAtOnce = users.slice(0, 2).map((u) => () =>
      dispatch(pool, appt, u.isHost ? u : host, EventType.GAME_START_REQUESTED),
    )
    const startResults = await Promise.all(startAtOnce.map((fn) => fn()))
    const startOk = startResults.filter((r) => r?.ok).length
    if (startOk > 1) {
      const phases = []
      for (const _ of startResults) {
        phases.push((await captureSnapshot(pool, appt.id))?.phase)
      }
      if (new Set(phases).size > 1) {
        metrics.raceConditionsDetected++
      }
    }
  } finally {
    await cleanupChaosRoom(pool, appt.id, userIds)
  }

  metrics.setCategory('C. Concurrency Attack', pass)
  return pass
}

/**
 * D. Idempotency
 */
export async function runIdempotency(pool, metrics, rng, opts) {
  const { appt, users, gameIds, host } = await seedChaosRoom(
    pool,
    `${opts.prefix}_idem`,
    Math.min(5, opts.userCount),
  )
  const userIds = users.map((u) => u.id)
  let pass = true

  try {
    await lobbyReadyAndStart(pool, appt, users)
    await dispatch(pool, appt, host, EventType.GAME_START_REQUESTED, { forceReadyLock: true })

    const fixedEventId = '00000000-0000-4000-8000-000000000099'
    let before = await captureSnapshot(pool, appt.id)

    for (let i = 0; i < 10; i++) {
      const res = await dispatch(
        pool,
        appt,
        host,
        EventType.GAME_START_REQUESTED,
        {},
        { eventId: fixedEventId, timestamp: 1_700_000_000_000 },
      )
      const after = await captureSnapshot(pool, appt.id)
      metrics.recordEvent(before, after, res)
      if (i > 0 && snapshotKey(before) !== snapshotKey(after) && res?.ok) {
        metrics.failCritical('IDEMPOTENT_GAME_START', 'state changed on duplicate')
        pass = false
      }
      if (i > 0 && !res?.ok) metrics.duplicatesIgnored++
      before = after
    }

    await dispatch(pool, appt, host, EventType.SPIN_STARTED)
    await fastForwardSpinReveal(pool, appt.id)
    const snap = await captureSnapshot(pool, appt.id)
    const title = snap?.activeSpinTitle ?? ''

    if (snap?.phase === RoomPhase.VETO_PHASE && title) {
      await ensureAllPresence(pool, appt.id, userIds)
      before = await captureSnapshot(pool, appt.id)
      const vetoId = '00000000-0000-4000-8000-000000000188'
      let lastKey = snapshotKey(before)

      for (let i = 0; i < 10; i++) {
        const res = await dispatch(
          pool,
          appt,
          users[1],
          EventType.VETO_USED,
          { vote: 'approve', gameTitle: title },
          { eventId: vetoId, timestamp: 1_700_000_000_100 + i },
        )
        const after = await captureSnapshot(pool, appt.id)
        metrics.recordEvent(before, after, res)
        const key = snapshotKey(after)
        if (i > 0 && key !== lastKey && res?.ok) {
          metrics.failCritical('IDEMPOTENT_VETO', `iteration ${i}`)
          pass = false
        }
        if (i > 0 && key === lastKey) metrics.duplicatesIgnored++
        lastKey = key
        before = after
      }
    }

    before = await captureSnapshot(pool, appt.id)
    for (let i = 0; i < 8; i++) {
      const res = await dispatch(pool, appt, users[2], EventType.PLAYER_READY_TOGGLED, {
        ready: i % 2 === 0,
      })
      metrics.recordEvent(before, await captureSnapshot(pool, appt.id), res)
    }
    const afterReady = await captureSnapshot(pool, appt.id)
    if (afterReady?.phase === RoomPhase.READY_LOCK && before?.phase === RoomPhase.WISH_COLLECTION) {
      /* ready spam may advance — ok */
    }

    await pool.query(
      `UPDATE appointments SET room_phase = $2, active_spin_id = NULL WHERE id = $1`,
      [appt.id, RoomPhase.READY_LOCK],
    )
    await pool.query(
      `UPDATE room_spins SET invalidated_at = now() WHERE appointment_id = $1 AND invalidated_at IS NULL`,
      [appt.id],
    )
    const freshAppt = (await pool.query(`SELECT * FROM appointments WHERE id = $1`, [appt.id]))
      .rows[0]
    before = await captureSnapshot(pool, appt.id)
    const dupSpinId = '00000000-0000-4000-8000-000000000277'
    const r1 = await dispatch(pool, freshAppt, host, EventType.SPIN_STARTED, {}, {
      eventId: dupSpinId,
    })
    const fresh2 = (await pool.query(`SELECT * FROM appointments WHERE id = $1`, [appt.id])).rows[0]
    const r2 = await dispatch(pool, fresh2, host, EventType.SPIN_STARTED, {}, {
      eventId: dupSpinId,
    })
    metrics.recordEvent(before, await captureSnapshot(pool, appt.id), r1)
    metrics.recordEvent(before, await captureSnapshot(pool, appt.id), r2)
    if (r1?.ok && r2?.ok && r1.spin?.spinId !== r2.spin?.spinId) {
      metrics.failCritical('DUPLICATE_SPIN_ID', 'two spins same request id')
      pass = false
    }
    if (r2?.ok && r1?.ok) {
      metrics.raceConditionsDetected++
      pass = false
    }
  } finally {
    await cleanupChaosRoom(pool, appt.id, userIds)
  }

  metrics.setCategory('D. Idempotency', pass)
  return pass
}

/**
 * E. Replay consistency — 先跑一轮规范流程，再对比重放
 */
export async function runReplayConsistency(pool, metrics, rng, opts) {
  const { appt, users, gameIds, host } = await seedChaosRoom(
    pool,
    `${opts.prefix}_replay`,
    opts.userCount,
  )
  const userIds = users.map((u) => u.id)
  let pass = true

  try {
    await lobbyReadyAndStart(pool, appt, users)
    await ensureAllPresence(pool, appt.id, userIds)
    for (const u of users) {
      await dispatch(pool, appt, u, EventType.WISHLIST_UPDATED, { gameIds })
      await dispatch(pool, appt, u, EventType.PLAYER_READY_TOGGLED, { ready: true })
    }
    let mid = await captureSnapshot(pool, appt.id)
    if (mid?.phase === RoomPhase.WISH_COLLECTION) {
      await dispatch(pool, appt, host, EventType.GAME_START_REQUESTED, { forceReadyLock: true })
    }
    await dispatch(pool, appt, host, EventType.SPIN_STARTED)
    await fastForwardSpinReveal(pool, appt.id)

    let snap = await captureSnapshot(pool, appt.id)
    snap = await driveToFinalized(pool, appt, users)
    if (snap?.phase !== RoomPhase.FINALIZED) {
      metrics.failCritical('REPLAY_SETUP', `expected FINALIZED got ${snap?.phase}`)
      pass = false
    }

    const cmp = await compareLiveVsReplay(
      pool,
      appt.id,
      `${opts.prefix}_replay`,
      opts.userCount,
      userIds,
    )

    metrics.replayMatch = cmp.match
  if (!cmp.match) {
      metrics.failCritical(
        'REPLAY_MISMATCH',
        `live=${cmp.liveKey} replay=${cmp.replayKey}`,
      )
      pass = false
    }

    metrics.finalConsistency = snap?.phase === RoomPhase.FINALIZED
  } finally {
    await cleanupChaosRoom(pool, appt.id, userIds)
  }

  metrics.setCategory('E. Replay Consistency', pass)
  return pass
}

/** 推进到 FINALIZED（处理 SPINNING / VETO / 重抽链） */
async function driveToFinalized(pool, appt, users) {
  const userIds = users.map((u) => u.id)
  let snap = await captureSnapshot(pool, appt.id)

  for (let guard = 0; guard < 6; guard++) {
    await ensureAllPresence(pool, appt.id, userIds)

    if (snap?.phase === RoomPhase.SPINNING) {
      await fastForwardSpinReveal(pool, appt.id)
      snap = await captureSnapshot(pool, appt.id)
      continue
    }

    const title = snap?.activeSpinTitle ?? ''
    if (snap?.phase === RoomPhase.VETO_PHASE && title) {
      for (const u of users) {
        await dispatch(pool, appt, u, EventType.VETO_USED, {
          vote: 'approve',
          gameTitle: title,
        })
      }
      snap = await captureSnapshot(pool, appt.id)
      if (snap?.phase === RoomPhase.FINALIZED) return snap
      continue
    }

    if (snap?.phase === RoomPhase.FINALIZED) return snap
    if (snap?.phase === RoomPhase.RESPINNING || snap?.phase === RoomPhase.READY_LOCK) {
      if (snap.phase === RoomPhase.READY_LOCK) {
        await dispatch(pool, appt, users[0], EventType.SPIN_STARTED)
      }
      snap = await captureSnapshot(pool, appt.id)
      continue
    }
    break
  }
  return snap
}

/**
 * 规范周期（供 replay 前积累足够 event log）
 */
export async function runCanonicalCycle(pool, metrics, opts) {
  const { appt, users, gameIds, host } = await seedChaosRoom(
    pool,
    `${opts.prefix}_canonical`,
    opts.userCount,
  )
  const userIds = users.map((u) => u.id)
  await lobbyReadyAndStart(pool, appt, users)
  await ensureAllPresence(pool, appt.id, userIds)
  for (const u of users) {
    await dispatch(pool, appt, u, EventType.WISHLIST_UPDATED, { gameIds })
    await dispatch(pool, appt, u, EventType.PLAYER_READY_TOGGLED, { ready: true })
  }
  let mid = await captureSnapshot(pool, appt.id)
  if (mid?.phase === RoomPhase.WISH_COLLECTION) {
    await dispatch(pool, appt, host, EventType.GAME_START_REQUESTED, { forceReadyLock: true })
  }
  await dispatch(pool, appt, host, EventType.SPIN_STARTED)
  await fastForwardSpinReveal(pool, appt.id)
  const snap = await captureSnapshot(pool, appt.id)
  if (snap?.phase === RoomPhase.VETO_PHASE) {
    await ensureAllPresence(pool, appt.id, userIds)
    for (const u of users) {
      await dispatch(pool, appt, u, EventType.VETO_USED, {
        vote: 'approve',
        gameTitle: snap.activeSpinTitle,
      })
    }
  }
  const final = await captureSnapshot(pool, appt.id)
  metrics.finalConsistency = final?.phase === RoomPhase.FINALIZED
  await cleanupChaosRoom(pool, appt.id, userIds)
  return final
}
