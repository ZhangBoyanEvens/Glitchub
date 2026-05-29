/**
 * Glitchub FSM 混沌 / 压力 / 并发测试套件
 *
 * A. Stress Smoke      — 10–20 用户，多轮周期 + spam
 * B. Chaos Ordering    — 乱序 + 随机延迟 + 丢包
 * C. Concurrency       — 同时 spin / veto / start
 * D. Idempotency       — 重复事件
 * E. Replay            — room_events 重放一致性
 *
 * 用法: npm run test:room-fsm-chaos
 * 环境:
 *   DATABASE_URL          必需
 *   CHAOS_SEED=42         可复现随机种子（默认 42）
 *   CHAOS_USERS=15        虚拟用户数（默认 15）
 *   CHAOS_CYCLES=4        Stress 轮数（默认 4）
 */
import 'dotenv/config'
import pg from 'pg'
import { ensureFsmSchema } from './chaos/fsmTestSchema.mjs'
import { ChaosMetrics, createRng } from './chaos/chaosHarness.mjs'
import {
  runCanonicalCycle,
  runChaosOrdering,
  runConcurrencyAttack,
  runIdempotency,
  runReplayConsistency,
  runStressSmoke,
} from './chaos/chaosRunners.mjs'

const SEED = Number(process.env.CHAOS_SEED ?? 42)
const FAST = process.env.CHAOS_FAST !== '0'
const USER_COUNT = Math.min(20, Math.max(10, Number(process.env.CHAOS_USERS ?? 10)))
const CYCLES = Math.min(5, Math.max(2, Number(process.env.CHAOS_CYCLES ?? 3)))
const SPAM_ROUNDS = Number(process.env.CHAOS_SPAM_ROUNDS ?? 1)
const PREFIX = `chaos_${SEED}`

async function main() {
  process.env.CHAOS_DISABLE_RATE_LIMIT = '1'
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    console.error('缺少 DATABASE_URL')
    process.exit(1)
  }

  const pool = new pg.Pool({ connectionString })
  const rng = createRng(SEED)
  const metrics = new ChaosMetrics(SEED)
  const opts = { prefix: PREFIX, userCount: USER_COUNT, cycles: CYCLES }

  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║   Glitchub FSM Chaos + Stress + Concurrency      ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log(
    `  Users: ${USER_COUNT}  Cycles: ${CYCLES}  Seed: ${SEED}  Fast latency: ${FAST}  Spam/用户: ${SPAM_ROUNDS}\n`,
  )

  try {
    const cat = await pool.query(`SELECT COUNT(*)::int AS n FROM reference_games`)
    if ((cat.rows[0]?.n ?? 0) < 1) {
      console.error('reference_games 为空 → npm run db:seed:reference-catalog')
      process.exit(1)
    }

    await ensureFsmSchema(pool)

    const t0 = Date.now()
    if (process.env.CHAOS_SKIP_STRESS !== '1') {
      console.log('▶ A. Stress Smoke Test …')
      await runStressSmoke(pool, metrics, rng, opts)
      console.log(`    (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`)
    } else {
      console.log('▶ A. Stress Smoke — SKIPPED (CHAOS_SKIP_STRESS=1)\n')
      metrics.setCategory('A. Stress Smoke', true)
    }

    console.log('▶ B. Chaos Event Ordering …')
    await runChaosOrdering(pool, metrics, rng, opts)

    console.log('▶ C. Concurrency Attack …')
    await runConcurrencyAttack(pool, metrics, rng, opts)

    console.log('▶ D. Idempotency …')
    await runIdempotency(pool, metrics, rng, opts)

    console.log('▶ E. Replay Consistency …')
    await runReplayConsistency(pool, metrics, rng, opts)

    console.log('▶ Canonical final-state check …')
    const final = await runCanonicalCycle(pool, metrics, opts)
    if (final?.phase !== 'FINALIZED') {
      metrics.failCritical('CANONICAL_NOT_FINALIZED', final?.phase)
      metrics.finalConsistency = false
    } else {
      metrics.finalConsistency = true
    }

    metrics.printReport()

    const allCategoriesPass = Object.values(metrics.categories).every(Boolean)
    const noCritical = metrics.criticalFailures.length === 0

    if (!allCategoriesPass || !noCritical) {
      process.exitCode = 1
      console.log('整体: FAIL')
    } else {
      console.log('整体: PASS')
    }
  } catch (err) {
    console.error('套件异常:', err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main()
