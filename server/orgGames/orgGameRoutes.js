import { clerkUserIdFromRequest } from '../clerkAuth.js'
import { requireOrgMember } from './clerkOrgAccess.js'
import { ensureOrgGamesSchema } from './orgGamesSchema.js'
import { resolveExpiredProposals, resolveProposalById } from './proposalResolver.js'

const VOTING_HOURS = Number(process.env.ORG_PROPOSAL_VOTING_HOURS ?? 24)
const URL_RE = /^https?:\/\/.+/i

/**
 * @param {import('pg').QueryResultRow} row
 * @param {string} viewerUserId
 */
function mapProposalRow(row, viewerUserId) {
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

/**
 * @param {import('express').Express} app
 * @param {import('pg').Pool | null} pool
 */
export function registerOrgGameRoutes(app, pool) {
  app.get('/api/org-games', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const orgId = String(req.query.orgId ?? '').trim()
    if (!orgId) {
      res.status(400).json({ ok: false, message: 'orgId is required' })
      return
    }

    const auth = await requireOrgMember(req, orgId)
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, message: auth.message })
      return
    }

    try {
      await resolveExpiredProposals(pool, orgId)
      const q = await pool.query(
        `SELECT id, org_id, game_name, steam_url, image_url, created_by, created_at
         FROM organization_games
         WHERE org_id = $1
         ORDER BY lower(trim(game_name))`,
        [orgId],
      )
      res.json({
        ok: true,
        games: q.rows.map((r) => ({
          id: r.id,
          orgId: r.org_id,
          gameName: r.game_name,
          steamUrl: r.steam_url ?? null,
          imageUrl: r.image_url ?? null,
          createdBy: r.created_by,
          createdAt: r.created_at,
        })),
      })
    } catch (err) {
      console.error('[org-games GET]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.get('/api/org-games/proposals', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const orgId = String(req.query.orgId ?? '').trim()
    const bucket = String(req.query.bucket ?? 'all').toLowerCase()
    if (!orgId) {
      res.status(400).json({ ok: false, message: 'orgId is required' })
      return
    }

    const auth = await requireOrgMember(req, orgId)
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, message: auth.message })
      return
    }

    try {
      await resolveExpiredProposals(pool, orgId)

      let statusFilter = ''
      if (bucket === 'pending') statusFilter = `AND p.status = 'PENDING'`
      else if (bucket === 'resolved') {
        statusFilter = `AND p.status IN ('APPROVED', 'REJECTED', 'EXPIRED')`
      }

      const q = await pool.query(
        `SELECT p.*, v.vote AS my_vote
         FROM organization_game_proposals p
         LEFT JOIN organization_game_votes v
           ON v.proposal_id = p.id AND v.user_id = $2
         WHERE p.org_id = $1 ${statusFilter}
         ORDER BY p.created_at DESC
         LIMIT 100`,
        [orgId, auth.userId],
      )

      const pending = []
      const resolved = []
      for (const row of q.rows) {
        const mapped = mapProposalRow(row, auth.userId)
        if (row.status === 'PENDING') pending.push(mapped)
        else resolved.push(mapped)
      }

      res.json({ ok: true, pending, resolved })
    } catch (err) {
      console.error('[org-games/proposals GET]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.post('/api/org-games/proposals', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const orgId = String(req.body?.orgId ?? '').trim()
    const proposalType = String(req.body?.proposalType ?? '').trim().toUpperCase()
    const gameName = String(req.body?.gameName ?? '').trim()
    const steamUrl =
      typeof req.body?.steamUrl === 'string' ? req.body.steamUrl.trim() : ''
    const imageUrl =
      typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : ''
    const targetGameId =
      typeof req.body?.targetGameId === 'string' ? req.body.targetGameId.trim() : ''

    if (!orgId) {
      res.status(400).json({ ok: false, message: 'orgId is required' })
      return
    }
    if (proposalType !== 'ADD_GAME' && proposalType !== 'REMOVE_GAME') {
      res.status(400).json({ ok: false, message: 'proposalType must be ADD_GAME or REMOVE_GAME' })
      return
    }
    if (steamUrl && !URL_RE.test(steamUrl)) {
      res.status(400).json({ ok: false, message: 'steamUrl must be http(s)' })
      return
    }
    if (imageUrl && !URL_RE.test(imageUrl)) {
      res.status(400).json({ ok: false, message: 'imageUrl must be http(s)' })
      return
    }

    const auth = await requireOrgMember(req, orgId)
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, message: auth.message })
      return
    }

    try {
      /** @type {import('pg').QueryResultRow | null} */
      let removeGame = null

      if (proposalType === 'ADD_GAME') {
        if (!gameName) {
          res.status(400).json({ ok: false, message: 'gameName is required' })
          return
        }
        const dupLib = await pool.query(
          `SELECT 1 FROM organization_games
           WHERE org_id = $1 AND lower(trim(game_name)) = lower(trim($2))`,
          [orgId, gameName],
        )
        if (dupLib.rows.length) {
          res.status(409).json({ ok: false, message: 'DUPLICATE_GAME_NAME' })
          return
        }
        const dupPending = await pool.query(
          `SELECT 1 FROM organization_game_proposals
           WHERE org_id = $1 AND proposal_type = 'ADD_GAME' AND status = 'PENDING'
             AND lower(trim(game_name)) = lower(trim($2))`,
          [orgId, gameName],
        )
        if (dupPending.rows.length) {
          res.status(409).json({ ok: false, message: 'DUPLICATE_PENDING_PROPOSAL' })
          return
        }
      } else {
        if (!targetGameId) {
          res.status(400).json({ ok: false, message: 'targetGameId is required for REMOVE_GAME' })
          return
        }
        const g = await pool.query(
          `SELECT id, game_name, steam_url, image_url
           FROM organization_games WHERE id = $1 AND org_id = $2`,
          [targetGameId, orgId],
        )
        if (!g.rows.length) {
          res.status(404).json({ ok: false, message: 'Game not found in organization library' })
          return
        }
        removeGame = g.rows[0]
        const dupRem = await pool.query(
          `SELECT 1 FROM organization_game_proposals
           WHERE org_id = $1 AND proposal_type = 'REMOVE_GAME' AND status = 'PENDING'
             AND target_game_id = $2`,
          [orgId, targetGameId],
        )
        if (dupRem.rows.length) {
          res.status(409).json({ ok: false, message: 'DUPLICATE_PENDING_REMOVAL' })
          return
        }
      }

      const finalName =
        proposalType === 'REMOVE_GAME' ? removeGame.game_name : gameName
      const finalSteam =
        proposalType === 'REMOVE_GAME' ? removeGame.steam_url : steamUrl || null
      const finalImage =
        proposalType === 'REMOVE_GAME' ? removeGame.image_url : imageUrl || null

      const expiresAt = new Date(Date.now() + VOTING_HOURS * 60 * 60 * 1000)

      const ins = await pool.query(
        `INSERT INTO organization_game_proposals (
           org_id, proposer_user_id, proposal_type, status, game_name,
           steam_url, image_url, target_game_id, expires_at
         )
         VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          orgId,
          auth.userId,
          proposalType,
          finalName,
          finalSteam,
          finalImage,
          proposalType === 'REMOVE_GAME' ? targetGameId : null,
          expiresAt,
        ],
      )

      res.status(201).json({
        ok: true,
        proposal: mapProposalRow({ ...ins.rows[0], my_vote: null }, auth.userId),
      })
    } catch (err) {
      console.error('[org-games/proposals POST]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.post('/api/org-games/proposals/:proposalId/vote', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const proposalId = String(req.params.proposalId ?? '').trim()
    const vote = String(req.body?.vote ?? '').trim().toUpperCase()
    if (!proposalId) {
      res.status(400).json({ ok: false, message: 'proposalId is required' })
      return
    }
    if (vote !== 'APPROVE' && vote !== 'REJECT') {
      res.status(400).json({ ok: false, message: 'vote must be APPROVE or REJECT' })
      return
    }

    const userId = await clerkUserIdFromRequest(req)
    if (!userId) {
      res.status(401).json({ ok: false, message: 'Unauthorized' })
      return
    }

    try {
      const pq = await pool.query(
        `SELECT * FROM organization_game_proposals WHERE id = $1`,
        [proposalId],
      )
      const proposal = pq.rows[0]
      if (!proposal) {
        res.status(404).json({ ok: false, message: 'Proposal not found' })
        return
      }

      const auth = await requireOrgMember(req, proposal.org_id)
      if (!auth.ok) {
        res.status(auth.status).json({ ok: false, message: auth.message })
        return
      }

      if (proposal.status !== 'PENDING') {
        res.status(409).json({ ok: false, message: 'Proposal is not open for voting' })
        return
      }
      if (new Date(proposal.expires_at).getTime() <= Date.now()) {
        await resolveProposalById(pool, proposalId)
        res.status(409).json({ ok: false, message: 'Voting period has ended' })
        return
      }

      await pool.query(
        `INSERT INTO organization_game_votes (proposal_id, user_id, vote)
         VALUES ($1, $2, $3)
         ON CONFLICT (proposal_id, user_id)
         DO UPDATE SET vote = EXCLUDED.vote, created_at = now()`,
        [proposalId, userId, vote],
      )

      const refreshed = await pool.query(
        `SELECT p.*, v.vote AS my_vote
         FROM organization_game_proposals p
         LEFT JOIN organization_game_votes v
           ON v.proposal_id = p.id AND v.user_id = $2
         WHERE p.id = $1`,
        [proposalId, userId],
      )

      res.json({
        ok: true,
        proposal: mapProposalRow(refreshed.rows[0], userId),
      })
    } catch (err) {
      console.error('[org-games/proposals/vote POST]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.post('/api/org-games/proposals/resolve', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const secret = process.env.ORG_PROPOSAL_RESOLVE_SECRET?.trim()
    const provided = String(req.headers['x-org-resolve-secret'] ?? '').trim()
    if (!secret || provided !== secret) {
      res.status(403).json({ ok: false, message: 'Forbidden' })
      return
    }

    try {
      const orgId = typeof req.body?.orgId === 'string' ? req.body.orgId.trim() : null
      const count = await resolveExpiredProposals(pool, orgId || null)
      res.json({ ok: true, resolvedCount: count })
    } catch (err) {
      console.error('[org-games/proposals/resolve POST]', err)
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}

/**
 * @param {import('pg').Pool} pool
 */
export function startOrgProposalResolverScheduler(pool) {
  const intervalMs = Number(process.env.ORG_PROPOSAL_RESOLVE_INTERVAL_MS ?? 60_000)
  if (!pool || intervalMs <= 0) return

  setInterval(() => {
    void resolveExpiredProposals(pool).catch((err) => {
      console.error('[orgGames] resolver tick failed', err)
    })
  }, intervalMs).unref?.()
}

export async function bootstrapOrgGames(pool) {
  if (!pool) return
  await ensureOrgGamesSchema(pool)
  startOrgProposalResolverScheduler(pool)
}
