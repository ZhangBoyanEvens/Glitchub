import { useEffect, useState } from 'react'
import { postRoomGameVote, type RoomGameVoteValue } from './roomGameVotesApi.ts'
import type { RoomGameSession } from './roomGameSessionApi.ts'
import { phaseAllowsVetoVote } from './roomFsmPhases.ts'

type Props = {
  roomId: string
  getToken: () => Promise<string | null>
  selfUserId: string | undefined
  gameTitle: string | null
  session: RoomGameSession
  myVote: RoomGameVoteValue | null
  variant?: 'default' | 'wishPool'
  onVoteSubmitted?: () => void
}

export function RoomCaseMemberVotes({
  roomId,
  getToken,
  selfUserId,
  gameTitle,
  session,
  myVote: myVoteProp,
  variant = 'default',
  onVoteSubmitted,
}: Props) {
  const [myVote, setMyVote] = useState<RoomGameVoteValue | null>(myVoteProp)
  const [vetoRemaining, setVetoRemaining] = useState(session.vetoRemaining)
  const [vetoUsed, setVetoUsed] = useState(session.vetoUsed)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const vetoPhase = phaseAllowsVetoVote(session.roomPhase)
  const vetoLimit = session.vetoLimit ?? 2
  const votesEnabled = vetoPhase && Boolean(gameTitle?.trim())

  useEffect(() => {
    setMyVote(myVoteProp)
  }, [myVoteProp])

  useEffect(() => {
    setVetoUsed(session.vetoUsed)
    setVetoRemaining(session.vetoRemaining)
  }, [session.vetoUsed, session.vetoRemaining])

  const submitVote = async (vote: RoomGameVoteValue) => {
    const rid = roomId.trim()
    if (!rid || !selfUserId) return
    if (!votesEnabled) {
      setErr('Voting is not available in this phase')
      return
    }
    if (vote === 'reject' && vetoPhase && vetoRemaining <= 0 && myVote !== 'reject') {
      setErr('No vetoes left (2 per person)')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const result = await postRoomGameVote(
        rid,
        { vote, gameTitle: gameTitle ?? undefined },
        { getToken },
      )
      setMyVote(vote)
      setVetoUsed(result.vetoUsed)
      setVetoRemaining(result.vetoRemaining)
      onVoteSubmitted?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const rejectDisabled =
    busy ||
    !selfUserId ||
    !votesEnabled ||
    (vetoPhase && vetoRemaining <= 0 && myVote !== 'reject')

  return (
    <div
      className={`roomCase__votes${variant === 'wishPool' ? ' roomCase__votes--wishPool' : ''}`}
      aria-label="Member votes"
    >
      <p className="roomCase__votesLead">
        {vetoPhase
          ? `Veto phase · Vetoes ${vetoUsed}/${vetoLimit}`
          : votesEnabled
            ? 'Vote on this result'
            : 'Vote after the draw is revealed'}
      </p>
      <div className="roomCase__voteActions" role="group" aria-label="Your vote">
        <button
          type="button"
          className={`roomCase__voteBtn roomCase__voteBtn--yes${myVote === 'approve' ? ' is-selected' : ''}`}
          disabled={busy || !selfUserId || !votesEnabled}
          aria-pressed={myVote === 'approve'}
          aria-label="Approve"
          title="Approve"
          onClick={() => void submitVote('approve')}
        >
          <span aria-hidden>✓</span>
        </button>
        <button
          type="button"
          className={`roomCase__voteBtn roomCase__voteBtn--no${myVote === 'reject' ? ' is-selected' : ''}`}
          disabled={rejectDisabled}
          aria-pressed={myVote === 'reject'}
          aria-label="Veto"
          title={vetoPhase ? `Veto (${vetoRemaining} left)` : 'Veto'}
          onClick={() => void submitVote('reject')}
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
      {err ? (
        <p className="roomCase__votesErr" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  )
}
