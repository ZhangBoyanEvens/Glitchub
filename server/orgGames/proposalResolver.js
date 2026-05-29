import { sendProposalRejectedEmail } from './proposalEmail.js'
import { listOrganizationMemberUserIds } from './clerkOrgAccess.js'

const PROPOSAL_TYPES = { ADD_GAME: 'ADD_GAME', REMOVE_GAME: 'REMOVE_GAME' }

/** @type {((orgId: string) => Promise<string[]>) | null} */
let memberIdsProviderForTests = null

/** @type {typeof sendProposalRejectedEmail | null} */
let rejectionEmailSenderForTests = null

/** Test-only hooks (integration scripts). */
export function __setOrgProposalTestHooks({
  memberIdsProvider = null,
  rejectionEmailSender = null,
} = {}) {
  memberIdsProviderForTests = memberIdsProvider
  rejectionEmailSenderForTests = rejectionEmailSender
}

export function __clearOrgProposalTestHooks() {
  memberIdsProviderForTests = null
  rejectionEmailSenderForTests = null
}

/**
 * 解析已到期 PENDING 提案（幂等、事务安全）
 *
 * @param {import('pg').Pool} pool
 * @param {string | null} [orgIdFilter]
 * @returns {Promise<number>} resolved count
 */
export async function resolveExpiredProposals(pool, orgIdFilter = null) {
  const params = []
  let where = `status = 'PENDING' AND expires_at <= now()`
  if (orgIdFilter) {
    params.push(orgIdFilter)
    where += ` AND org_id = $1`
  }

  const pending = await pool.query(
    `SELECT id FROM organization_game_proposals WHERE ${where} ORDER BY expires_at ASC LIMIT 50`,
    params,
  )

  let count = 0
  for (const row of pending.rows) {
    const ok = await resolveProposalById(pool, row.id)
    if (ok) count++
  }
  return count
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} proposalId
 */
export async function resolveProposalById(pool, proposalId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const lock = await client.query(
      `SELECT * FROM organization_game_proposals WHERE id = $1 FOR UPDATE`,
      [proposalId],
    )
    const proposal = lock.rows[0]
    if (!proposal || proposal.status !== 'PENDING') {
      await client.query('ROLLBACK')
      return false
    }
    if (new Date(proposal.expires_at).getTime() > Date.now()) {
      await client.query('ROLLBACK')
      return false
    }

    const memberIds = memberIdsProviderForTests
      ? await memberIdsProviderForTests(proposal.org_id)
      : await listOrganizationMemberUserIds(proposal.org_id)
    const votesQ = await client.query(
      `SELECT user_id, vote FROM organization_game_votes WHERE proposal_id = $1`,
      [proposalId],
    )
    const approve = votesQ.rows.filter((v) => v.vote === 'APPROVE').map((v) => v.user_id)
    const reject = votesQ.rows.filter((v) => v.vote === 'REJECT').map((v) => v.user_id)
    const voted = new Set(votesQ.rows.map((v) => v.user_id))
    const missing = memberIds.filter((id) => !voted.has(id))

    let effectiveApprove
    let effectiveReject
    if (proposal.proposal_type === PROPOSAL_TYPES.ADD_GAME) {
      effectiveApprove = approve.length + missing.length
      effectiveReject = reject.length
    } else {
      effectiveApprove = approve.length
      effectiveReject = reject.length + missing.length
    }

    const approved = effectiveApprove > effectiveReject

    if (approved) {
      if (proposal.proposal_type === PROPOSAL_TYPES.ADD_GAME) {
        const dup = await client.query(
          `SELECT 1 FROM organization_games
           WHERE org_id = $1 AND lower(trim(game_name)) = lower(trim($2))`,
          [proposal.org_id, proposal.game_name],
        )
        if (!dup.rows.length) {
          await client.query(
            `INSERT INTO organization_games (org_id, game_name, steam_url, image_url, created_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              proposal.org_id,
              proposal.game_name.trim(),
              proposal.steam_url || null,
              proposal.image_url || null,
              proposal.proposer_user_id,
            ],
          )
        }
      } else if (proposal.target_game_id) {
        await client.query(
          `DELETE FROM organization_games
           WHERE id = $1 AND org_id = $2`,
          [proposal.target_game_id, proposal.org_id],
        )
      }

      await client.query(
        `UPDATE organization_game_proposals
         SET status = 'APPROVED', resolved_at = now()
         WHERE id = $1 AND status = 'PENDING'`,
        [proposalId],
      )
    } else {
      await client.query(
        `UPDATE organization_game_proposals
         SET status = 'REJECTED', resolved_at = now()
         WHERE id = $1 AND status = 'PENDING'`,
        [proposalId],
      )
    }

    await client.query('COMMIT')

    if (!approved && !proposal.resolution_email_sent_at) {
      try {
        const emailFn = rejectionEmailSenderForTests ?? sendProposalRejectedEmail
        const sent = await emailFn(pool, proposal)
        if (sent) {
          await pool.query(
            `UPDATE organization_game_proposals
             SET resolution_email_sent_at = now()
             WHERE id = $1`,
            [proposalId],
          )
        }
      } catch (err) {
        console.error('[orgGames] rejection email failed', err)
      }
    }

    return true
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
