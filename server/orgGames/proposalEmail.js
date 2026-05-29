import { Resend } from 'resend'
import { resolveUserPrimaryEmailLower } from '../clerkUserEmail.js'

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ proposer_user_id: string, game_name: string, proposal_type: string }} proposal
 */
export async function sendProposalRejectedEmail(pool, proposal) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    console.warn('[orgGames] Resend not configured; skip rejection email')
    return false
  }

  const to = await resolveUserPrimaryEmailLower(pool, proposal.proposer_user_id)
  if (!to) {
    console.warn('[orgGames] No email for proposer', proposal.proposer_user_id)
    return false
  }

  const typeLabel =
    proposal.proposal_type === 'REMOVE_GAME' ? 'REMOVE_GAME' : 'ADD_GAME'
  const gameName = escapeHtml(proposal.game_name)
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL.trim()

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#0f172a;">
<p>Your proposal for:</p>
<p><strong>${gameName}</strong></p>
<p>was rejected by organization voting.</p>
<p>Proposal type:<br/><strong>${escapeHtml(typeLabel)}</strong></p>
<p>Thank you for contributing to Glitchub.</p>
</body></html>`

  const text = `Your proposal for: ${proposal.game_name}\n\nwas rejected by organization voting.\n\nProposal type: ${typeLabel}\n\nThank you for contributing to Glitchub.`

  await resend.emails.send({
    from,
    to: [to],
    subject: 'Game Proposal Rejected',
    html,
    text,
  })
  return true
}
