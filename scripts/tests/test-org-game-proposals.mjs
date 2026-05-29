/**
 * Organization Game Proposal System — light integration / workflow smoke test.
 *
 * Covers: ADD_GAME approve, REMOVE_GAME reject, blind voting, 24h resolution,
 * rejection email hook, resolver idempotency.
 *
 * No Clerk JWT. Direct DB + service-layer resolver invocation.
 *
 * Usage: npm run test:org-game-proposals
 * Requires: DATABASE_URL
 */
import 'dotenv/config'
import pg from 'pg'
import { createDbPool } from '../../server/dbPool.js'
import { ensureOrgGamesSchema } from '../../server/orgGames/orgGamesSchema.js'
import {
  __clearOrgProposalTestHooks,
  __setOrgProposalTestHooks,
  resolveExpiredProposals,
  resolveProposalById,
} from '../../server/orgGames/proposalResolver.js'

const PREFIX = `ogp_${Date.now().toString(36)}`
const ORG_ID = `${PREFIX}_org`

const USERS = {
  host: { id: `${PREFIX}_host`, email: `${PREFIX}_host@test.local`, label: 'user_host' },
  u2: { id: `${PREFIX}_u2`, email: `${PREFIX}_u2@test.local`, label: 'user_2' },
  u3: { id: `${PREFIX}_u3`, email: `${PREFIX}_u3@test.local`, label: 'user_3' },
  u4: { id: `${PREFIX}_u4`, email: `${PREFIX}_u4@test.local`, label: 'user_4' },
  u5: { id: `${PREFIX}_u5`, email: `${PREFIX}_u5@test.local`, label: 'user_5' },
}

const MEMBER_IDS = Object.values(USERS).map((u) => u.id)

/** @type {Record<string, 'PASS' | 'FAIL'>} */
const scenarioResults = {}

/** @type {string[]} */
const flowSteps = []

const metrics = {
  proposalsCreated: 0,
  votesCast: 0,
  proposalsApproved: 0,
  proposalsRejected: 0,
  emailsTriggered: 0,
  duplicateMutationsPrevented: 0,
  idempotencyRuns: 0,
  idempotencySafe: true,
}

let emailSendCount = 0
/** @type {import('pg').Pool | null} */
let pool = null
/** @type {string | null} */
let valorantGameId = null
/** @type {string | null} */
let addProposalId = null
/** @type {string | null} */
let removeProposalId = null

function log(msg) {
  console.log(msg)
}

function fail(scenario, step, cause, dbSnapshot = null) {
  scenarioResults[scenario] = 'FAIL'
  log(`\n✗ [${scenario}] FAIL at: ${step}`)
  log(`  Root cause: ${cause}`)
  if (dbSnapshot) {
    log(`  DB snapshot: ${JSON.stringify(dbSnapshot, null, 2)}`)
  }
}

function pass(scenario) {
  if (scenarioResults[scenario] !== 'FAIL') {
    scenarioResults[scenario] = 'PASS'
  }
}

function recordFlow(step) {
  flowSteps.push(step)
}

/** Mirrors orgGameRoutes mapProposalRow — blind voting surface. */
function mapProposalForViewer(row, viewerUserId) {
  const expiresMs = new Date(row.expires_at).getTime()
  const msLeft = Math.max(0, expiresMs - Date.now())
  return {
    id: row.id,
    orgId: row.org_id,
    proposalType: row.proposal_type,
    status: row.status,
    gameName: row.game_name,
    steamUrl: row.steam_url ?? null,
    imageUrl: row.image_url ?? null,
    targetGameId: row.target_game_id ?? null,
    proposerUserId: row.proposer_user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at ?? null,
    expiresInMs: msLeft,
    myVote: row.my_vote ?? null,
    hasVoted: Boolean(row.my_vote),
  }
}

const FORBIDDEN_BLIND_KEYS = [
  'approveCount',
  'rejectCount',
  'voteCount',
  'tally',
  'progress',
  'percent',
  'approveTotal',
  'rejectTotal',
  'votesApprove',
  'votesReject',
]

function assertBlindVotingView(mapped, context) {
  const keys = Object.keys(mapped)
  for (const key of keys) {
    if (FORBIDDEN_BLIND_KEYS.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
      throw new Error(`Blind voting leak: field "${key}" exposed (${context})`)
    }
  }
  const allowed = new Set([
    'id',
    'orgId',
    'proposalType',
    'status',
    'gameName',
    'steamUrl',
    'imageUrl',
    'targetGameId',
    'proposerUserId',
    'createdAt',
    'expiresAt',
    'resolvedAt',
    'expiresInMs',
    'myVote',
    'hasVoted',
  ])
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new Error(`Unexpected proposal field "${key}" (${context})`)
    }
  }
}

async function seedUsers(p) {
  for (const u of Object.values(USERS)) {
    await p.query(
      `INSERT INTO clerk_synced_users (clerk_user_id, primary_email, first_name, last_name)
       VALUES ($1, $2, $3, '')
       ON CONFLICT (clerk_user_id) DO UPDATE SET primary_email = EXCLUDED.primary_email`,
      [u.id, u.email, u.label],
    )
  }
}

async function seedGames(p) {
  const games = [
    { name: 'Valorant', steam: 'https://store.steampowered.com/app/0', by: USERS.host.id },
    {
      name: 'Lethal Company',
      steam: 'https://store.steampowered.com/app/1966720',
      by: USERS.host.id,
    },
  ]
  for (const g of games) {
    const ins = await p.query(
      `INSERT INTO organization_games (org_id, game_name, steam_url, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, game_name`,
      [ORG_ID, g.name, g.steam, g.by],
    )
    if (g.name === 'Valorant') valorantGameId = ins.rows[0].id
  }
}

async function createProposal(p, {
  proposerUserId,
  proposalType,
  gameName,
  targetGameId = null,
  steamUrl = null,
  imageUrl = null,
}) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const ins = await p.query(
    `INSERT INTO organization_game_proposals (
       org_id, proposer_user_id, proposal_type, status, game_name,
       steam_url, image_url, target_game_id, expires_at
     )
     VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8)
     RETURNING *`,
    [ORG_ID, proposerUserId, proposalType, gameName, steamUrl, imageUrl, targetGameId, expiresAt],
  )
  metrics.proposalsCreated++
  recordFlow(`proposal created (${proposalType}: ${gameName})`)
  return ins.rows[0]
}

async function castVote(p, proposalId, userId, vote) {
  await p.query(
    `INSERT INTO organization_game_votes (proposal_id, user_id, vote)
     VALUES ($1, $2, $3)
     ON CONFLICT (proposal_id, user_id)
     DO UPDATE SET vote = EXCLUDED.vote, created_at = now()`,
    [proposalId, userId, vote],
  )
  metrics.votesCast++
  recordFlow(`${userId} voted ${vote}`)
}

async function expireProposal(p, proposalId) {
  await p.query(
    `UPDATE organization_game_proposals
     SET expires_at = now() - interval '1 minute'
     WHERE id = $1`,
    [proposalId],
  )
  recordFlow(`proposal ${proposalId.slice(0, 8)}… fast-forwarded past 24h`)
}

async function getProposal(p, proposalId) {
  const q = await p.query(`SELECT * FROM organization_game_proposals WHERE id = $1`, [proposalId])
  return q.rows[0] ?? null
}

async function getProposalViewForUser(p, proposalId, viewerUserId) {
  const q = await p.query(
    `SELECT p.*, v.vote AS my_vote
     FROM organization_game_proposals p
     LEFT JOIN organization_game_votes v
       ON v.proposal_id = p.id AND v.user_id = $2
     WHERE p.id = $1`,
    [proposalId, viewerUserId],
  )
  return q.rows[0] ? mapProposalForViewer(q.rows[0], viewerUserId) : null
}

async function listOrgGames(p) {
  const q = await p.query(
    `SELECT id, game_name FROM organization_games WHERE org_id = $1 ORDER BY lower(trim(game_name))`,
    [ORG_ID],
  )
  return q.rows
}

async function countGameByName(p, name) {
  const q = await p.query(
    `SELECT count(*)::int AS c FROM organization_games
     WHERE org_id = $1 AND lower(trim(game_name)) = lower(trim($2))`,
    [ORG_ID, name],
  )
  return q.rows[0].c
}

async function scenarioA_AddGameApprove(p) {
  const SC = 'A — ADD_GAME (Approve)'
  log(`\n--- ${SC} ---`)
  try {
    const proposal = await createProposal(p, {
      proposerUserId: USERS.host.id,
      proposalType: 'ADD_GAME',
      gameName: 'Among Us',
      steamUrl: 'https://store.steampowered.com/app/945360',
    })
    addProposalId = proposal.id

    if (proposal.status !== 'PENDING') {
      fail(SC, 'create proposal', `expected PENDING, got ${proposal.status}`)
      return
    }

    await castVote(p, proposal.id, USERS.u2.id, 'APPROVE')
    await castVote(p, proposal.id, USERS.u3.id, 'APPROVE')

    for (const uid of [USERS.u2.id, USERS.u3.id, USERS.u4.id]) {
      const view = await getProposalViewForUser(p, proposal.id, uid)
      assertBlindVotingView(view, uid)
      if (uid === USERS.u2.id || uid === USERS.u3.id) {
        if (!view.hasVoted || view.myVote !== 'APPROVE') {
          throw new Error(`Expected vote submitted for ${uid}`)
        }
      } else if (view.hasVoted) {
        throw new Error(`Expected pending vote state for ${uid}`)
      }
    }

    recordFlow('blind voting validated (no counts exposed)')

    await expireProposal(p, proposal.id)
    const resolved = await resolveProposalById(p, proposal.id)
    if (!resolved) {
      fail(SC, 'resolve', 'resolveProposalById returned false')
      return
    }
    recordFlow('resolver ran → APPROVED path')

    const after = await getProposal(p, proposal.id)
    if (after.status !== 'APPROVED') {
      fail(SC, 'status check', `expected APPROVED, got ${after.status}`, { proposal: after })
      return
    }
    metrics.proposalsApproved++

    const amongCount = await countGameByName(p, 'Among Us')
    if (amongCount !== 1) {
      fail(SC, 'library insert', `expected 1 Among Us row, got ${amongCount}`)
      return
    }

    const resolvedAgain = await resolveProposalById(p, proposal.id)
    if (resolvedAgain) {
      fail(SC, 'idempotent single resolve', 'second resolve should no-op')
      return
    }
    const amongAfter = await countGameByName(p, 'Among Us')
    if (amongAfter !== 1) {
      metrics.duplicateMutationsPrevented++
      fail(SC, 'duplicate insert guard', `Among Us count became ${amongAfter}`)
      return
    }
    metrics.duplicateMutationsPrevented++

    pass(SC)
    log(`  ✓ ${SC}: PASS`)
  } catch (e) {
    fail(SC, 'exception', e instanceof Error ? e.message : String(e))
    log(`  ✗ ${SC}: FAIL`)
  }
}

async function scenarioB_RemoveGameReject(p) {
  const SC = 'B — REMOVE_GAME (Reject + Email)'
  log(`\n--- ${SC} ---`)
  try {
    if (!valorantGameId) throw new Error('Valorant seed missing')

    emailSendCount = 0
    const proposal = await createProposal(p, {
      proposerUserId: USERS.host.id,
      proposalType: 'REMOVE_GAME',
      gameName: 'Valorant',
      targetGameId: valorantGameId,
    })
    removeProposalId = proposal.id

    await castVote(p, proposal.id, USERS.u2.id, 'APPROVE')
    await castVote(p, proposal.id, USERS.u3.id, 'REJECT')

    await expireProposal(p, proposal.id)
    const resolved = await resolveProposalById(p, proposal.id)
    if (!resolved) {
      fail(SC, 'resolve', 'resolveProposalById returned false')
      return
    }
    recordFlow('resolver ran → REJECTED path + email hook')

    const after = await getProposal(p, proposal.id)
    if (after.status !== 'REJECTED') {
      fail(SC, 'status check', `expected REJECTED, got ${after.status}`, { proposal: after })
      return
    }
    metrics.proposalsRejected++

    const valorantCount = await countGameByName(p, 'Valorant')
    if (valorantCount !== 1) {
      fail(SC, 'library preserved', `Valorant should remain, count=${valorantCount}`)
      return
    }

    if (emailSendCount !== 1) {
      fail(SC, 'rejection email', `expected 1 email, got ${emailSendCount}`)
      return
    }
    metrics.emailsTriggered += emailSendCount

    if (!after.resolution_email_sent_at) {
      fail(SC, 'email timestamp', 'resolution_email_sent_at not set')
      return
    }

    pass(SC)
    log(`  ✓ ${SC}: PASS`)
  } catch (e) {
    fail(SC, 'exception', e instanceof Error ? e.message : String(e))
    log(`  ✗ ${SC}: FAIL`)
  }
}

async function scenarioC_ResolverIdempotency(p) {
  const SC = 'C — Resolver Idempotency'
  log(`\n--- ${SC} ---`)
  try {
    const gamesBefore = await listOrgGames(p)
    const addBefore = await getProposal(p, addProposalId)
    const remBefore = await getProposal(p, removeProposalId)
    const emailBefore = emailSendCount

    let extraResolved = 0
    for (let i = 0; i < 3; i++) {
      const n = await resolveExpiredProposals(p, ORG_ID)
      extraResolved += n
      metrics.idempotencyRuns++
      const againAdd = await resolveProposalById(p, addProposalId)
      const againRem = await resolveProposalById(p, removeProposalId)
      if (againAdd || againRem) {
        metrics.idempotencySafe = false
        fail(SC, `run ${i + 1}`, 'resolved already-finished proposals')
        return
      }
    }

    if (extraResolved > 0) {
      metrics.idempotencySafe = false
      fail(SC, 'resolveExpiredProposals', `unexpected ${extraResolved} extra resolutions`)
      return
    }

    const gamesAfter = await listOrgGames(p)
    if (gamesAfter.length !== gamesBefore.length) {
      metrics.idempotencySafe = false
      fail(SC, 'library size', `games changed ${gamesBefore.length} → ${gamesAfter.length}`)
      return
    }

    const amongCount = await countGameByName(p, 'Among Us')
    const valorantCount = await countGameByName(p, 'Valorant')
    if (amongCount !== 1 || valorantCount !== 1) {
      metrics.idempotencySafe = false
      fail(SC, 'mutation check', `Among Us=${amongCount}, Valorant=${valorantCount}`)
      return
    }

    const addAfter = await getProposal(p, addProposalId)
    const remAfter = await getProposal(p, removeProposalId)
    if (addAfter.status !== addBefore.status || remAfter.status !== remBefore.status) {
      metrics.idempotencySafe = false
      fail(SC, 'status drift', 'proposal statuses changed on idempotent runs')
      return
    }

    if (emailSendCount !== emailBefore) {
      metrics.idempotencySafe = false
      fail(SC, 'duplicate email', `emails ${emailBefore} → ${emailSendCount}`)
      return
    }

    metrics.duplicateMutationsPrevented++
    pass(SC)
    log(`  ✓ ${SC}: PASS`)
  } catch (e) {
    fail(SC, 'exception', e instanceof Error ? e.message : String(e))
    log(`  ✗ ${SC}: FAIL`)
  }
}

async function cleanup(p) {
  log('\n--- cleanup ---')
  await p.query(
    `DELETE FROM organization_game_votes
     WHERE proposal_id IN (
       SELECT id FROM organization_game_proposals WHERE org_id = $1
     )`,
    [ORG_ID],
  )
  await p.query(`DELETE FROM organization_game_proposals WHERE org_id = $1`, [ORG_ID])
  await p.query(`DELETE FROM organization_games WHERE org_id = $1`, [ORG_ID])
  for (const u of Object.values(USERS)) {
    await p.query(`DELETE FROM clerk_synced_users WHERE clerk_user_id = $1`, [u.id])
  }
  log('  test data removed')
}

function buildMermaid() {
  const approved = scenarioResults['A — ADD_GAME (Approve)'] === 'PASS'
  const rejected = scenarioResults['B — REMOVE_GAME (Reject + Email)'] === 'PASS'
  const idempotent = scenarioResults['C — Resolver Idempotency'] === 'PASS'

  return `flowchart TD
    subgraph setup [Test Setup]
      O[Organization ${ORG_ID}]
      M[5 virtual members]
      G[Seed: Valorant + Lethal Company]
    end

    subgraph scenarioA [Scenario A — ADD_GAME]
      A1[user_host proposes Among Us]
      A2[PENDING status]
      A3[user_2 APPROVE · user_3 APPROVE]
      A4[Blind vote UI: submitted/pending only]
      A5[Fast-forward expires_at + 24h]
      A6[Resolver: missing votes → APPROVE]
      A7[Status APPROVED]
      A8[Insert Among Us into library]
    end

    subgraph scenarioB [Scenario B — REMOVE_GAME]
      B1[user_host proposes remove Valorant]
      B2[user_2 APPROVE · user_3 REJECT]
      B3[Fast-forward expiration]
      B4[Resolver: missing votes → REJECT]
      B5[Status REJECTED]
      B6[Valorant remains in library]
      B7[Rejection email to proposer]
    end

    subgraph scenarioC [Scenario C — Idempotency]
      C1[Run resolver 3×]
      C2[No duplicate insert/delete]
      C3[No duplicate emails]
      C4[Statuses unchanged]
    end

    O --> A1
    M --> A3
    G --> B1
    A1 --> A2 --> A3 --> A4 --> A5 --> A6 --> A7 --> A8
    B1 --> B2 --> B3 --> B4 --> B5 --> B6 --> B7
    A8 --> C1
    B7 --> C1
    C1 --> C2 --> C3 --> C4

    A7 -.- A_OK[${approved ? 'PASS' : 'FAIL'}]
    B5 -.- B_OK[${rejected ? 'PASS' : 'FAIL'}]
    C4 -.- C_OK[${idempotent ? 'PASS' : 'FAIL'}]`
}

function printReport() {
  const allPass = Object.values(scenarioResults).every((r) => r === 'PASS')
  const verdict = allPass && metrics.idempotencySafe ? 'PASS' : 'FAIL'

  log('\n=== GLITCHUB GAME PROPOSAL TEST REPORT ===\n')
  log('Scenario results:')
  for (const [name, result] of Object.entries(scenarioResults)) {
    log(`  • ${name}: ${result}`)
  }
  log('')
  log('Metrics:')
  log(`  • proposals created: ${metrics.proposalsCreated}`)
  log(`  • votes cast: ${metrics.votesCast}`)
  log(`  • proposals approved: ${metrics.proposalsApproved}`)
  log(`  • proposals rejected: ${metrics.proposalsRejected}`)
  log(`  • emails triggered: ${metrics.emailsTriggered}`)
  log(`  • duplicate mutations prevented: ${metrics.duplicateMutationsPrevented}`)
  log(`  • idempotency runs: ${metrics.idempotencyRuns}`)
  log(`  • idempotency safe: ${metrics.idempotencySafe ? 'yes' : 'no'}`)
  log('')
  log(`Final verdict: ${verdict}`)
  log('')
  log('--- Mermaid flow (executed path) ---')
  log('```mermaid')
  log(buildMermaid())
  log('```')

  return verdict === 'PASS' ? 0 : 1
}

async function main() {
  const cs = process.env.DATABASE_URL?.trim()
  if (!cs) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  pool = createDbPool(cs)
  const started = Date.now()

  __setOrgProposalTestHooks({
    memberIdsProvider: async () => MEMBER_IDS,
    rejectionEmailSender: async () => {
      emailSendCount++
      return true
    },
  })

  try {
    log(`=== Glitchub Org Game Proposal Integration Test ===`)
    log(`Prefix: ${PREFIX}`)

    await ensureOrgGamesSchema(pool)
    await seedUsers(pool)
    await seedGames(pool)
    recordFlow('org + 5 members + 2 games seeded')

    await scenarioA_AddGameApprove(pool)
    await scenarioB_RemoveGameReject(pool)
    await scenarioC_ResolverIdempotency(pool)
  } finally {
    __clearOrgProposalTestHooks()
    if (pool) {
      await cleanup(pool)
      await pool.end()
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(2)
    log(`\nRuntime: ${elapsed}s`)
  }

  const code = printReport()
  process.exit(code)
}

main().catch((err) => {
  console.error(err)
  __clearOrgProposalTestHooks()
  process.exit(1)
})
