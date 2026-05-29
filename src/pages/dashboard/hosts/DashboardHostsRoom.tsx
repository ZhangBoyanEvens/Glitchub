import { useAuth, useUser } from '@clerk/clerk-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clerkSelfDisplayId } from './clerkSelfDisplayId.ts'
import { HostsUserBadge } from './HostsUserBadge.tsx'
import { RoomMemberVoteBadge } from './RoomMemberVoteBadge.tsx'
import { RoomCaseMemberVotes } from './RoomCaseMemberVotes.tsx'
import { RoomCaseOpening } from './RoomCaseOpening.tsx'
import { RoomGameFinalReveal } from './RoomGameFinalReveal.tsx'
import { RoomStatusHeader } from './RoomStatusHeader.tsx'
import { ReliabilityBadge } from './ReliabilityBadge.tsx'
import { WishPoolGameSlots } from './WishPoolGameSlots.tsx'
import { isUnanimousOnlineApprove } from './roomVoteConsensus.ts'
import {
  ROOM_PHASE_LABEL,
  phaseAllowsVetoVote,
  phaseAllowsWishEdit,
  type RoomPhase,
} from './roomFsmPhases.ts'
import { phaseActionGuidance } from './roomUxCopy.ts'
import type { RoomLastGameResult } from './roomLastResult.ts'
import { useRoomLiveSync } from './useRoomLiveSync.ts'

/**
 * In-room session page: full viewport below top bar; left 25% participants, 15% wish pool, rest main (case opening).
 * State merged via GET /api/rooms/:id/live to reduce Neon round-trips and Clerk latency.
 */
export function DashboardHostsRoom() {
  const navigate = useNavigate()
  const { roomId: roomIdParam } = useParams()
  const roomId = roomIdParam ? decodeURIComponent(roomIdParam) : ''
  const { user, isLoaded: userLoaded } = useUser()
  const { getToken } = useAuth()

  const [wishGameIds, setWishGameIds] = useState<number[]>([])
  const [lastGameResult, setLastGameResult] = useState<RoomLastGameResult | null>(null)
  const [finalReveal, setFinalReveal] = useState<RoomLastGameResult | null>(null)
  const revealedTitleRef = useRef<string | null>(null)

  const {
    members,
    session: gameSession,
    loadErr,
    starting: gameStarting,
    startNotice: gameStartNotice,
    dismissStartNotice,
    handleStart: handleStartGame,
    handleReadyToggle,
    handleForceLock,
    readyBusy,
    lockBusy,
    reloadLive,
    votesForTitle,
    wishPool: liveWishPool,
    liveTick,
  } = useRoomLiveSync(roomId, getToken)

  const memberVotesByUserId = useMemo(() => {
    const title = lastGameResult?.title?.trim()
    if (!title) return new Map()
    return votesForTitle(title)
  }, [lastGameResult, votesForTitle, liveTick])

  const onLastResultChange = useCallback((result: RoomLastGameResult | null) => {
    setLastGameResult(result)
    const title = result?.title?.trim() ?? null
    if (title !== revealedTitleRef.current) {
      setFinalReveal(null)
    }
  }, [])

  const onSavedGameIdsChange = useCallback((ids: number[]) => {
    setWishGameIds(ids)
  }, [])

  const hostsExitPath =
    gameSession?.roomKind === 'instant'
      ? '/dashboard/hosts/lobby'
      : '/dashboard/hosts/join'

  const onRoomEnded = useCallback(() => {
    navigate(hostsExitPath, { replace: true })
  }, [navigate, hostsExitPath])

  useEffect(() => {
    if (gameSession?.roomPhase === 'FINALIZED' && gameSession.finalGameTitle) {
      const title = gameSession.finalGameTitle.trim()
      if (title && revealedTitleRef.current !== title) {
        revealedTitleRef.current = title
        setFinalReveal({
          title,
          id: gameSession.finalGameId,
        })
      }
      return
    }

    const title = lastGameResult?.title?.trim()
    if (!title || !phaseAllowsVetoVote(gameSession?.roomPhase) || !members?.length) return
    if (revealedTitleRef.current === title) return
    if (!isUnanimousOnlineApprove(members, memberVotesByUserId, title)) return

    revealedTitleRef.current = title
    setFinalReveal({
      title,
      id: lastGameResult?.id ?? null,
    })
  }, [
    members,
    memberVotesByUserId,
    lastGameResult,
    gameSession?.roomPhase,
    gameSession?.finalGameTitle,
    gameSession?.finalGameId,
  ])

  const selfDisplay = user ? clerkSelfDisplayId(user) : ''
  const roomPhase = (gameSession?.roomPhase ?? 'LOBBY') as RoomPhase
  const votingActive =
    phaseAllowsVetoVote(roomPhase) && Boolean(lastGameResult?.title?.trim())
  const wishLocked = !phaseAllowsWishEdit(roomPhase)
  const lastGameTitle = lastGameResult?.title ?? null
  const selfImage = user?.imageUrl
  const isInstantRoom = gameSession?.roomKind === 'instant'
  const allReady = gameSession?.readiness?.allReady ?? false
  const wishPoolSaved = wishGameIds.length === 3 && wishGameIds.every((id) => id >= 0)
  const selfVote =
    user?.id && lastGameTitle
      ? memberVotesByUserId.get(user.id)
      : undefined
  const progressLines = [
    gameSession?.progress?.ready,
    roomPhase === 'WISH_COLLECTION' ? gameSession?.progress?.wishPool : null,
    roomPhase === 'VETO_PHASE' ? gameSession?.progress?.voting : null,
  ].filter(Boolean) as string[]
  const guidance = phaseActionGuidance(roomPhase, {
    isHost: gameSession?.isHost ?? false,
    selfReady: gameSession?.selfReady ?? false,
    allReady,
    wishPoolSaved,
    hasVoted: Boolean(selfVote),
  })

  function memberPresenceLabel(m: { isOnline: boolean; ready?: boolean }) {
    if (!m.isOnline) return { emoji: '⚫', text: 'Offline' }
    if (m.ready) return { emoji: '🟢', text: 'Ready' }
    return { emoji: '🟡', text: 'Waiting' }
  }

  return (
    <div className="dashboard__hostsLiveRoom">
      <header className="dashboard__hostsLiveRoomBar">
        <Link to={hostsExitPath} className="dashboard__hostsBackBtn" replace>
          <span className="dashboard__hostsBackBtnIcon" aria-hidden>
            ←
          </span>
          <span className="dashboard__hostsBackBtnText">Leave room</span>
        </Link>
        {userLoaded && user ? (
          <div className="dashboard__hostsLiveRoomBarSelf">
            <HostsUserBadge
              presence="inside_room"
              imageUrl={selfImage}
              displayId={selfDisplay}
            />
          </div>
        ) : null}
        <span className="dashboard__hostsLiveRoomBarSpacer" aria-hidden />
        <div className="dashboard__hostsLiveRoomBarMeta">
          {isInstantRoom && gameSession?.joinCode ? (
            <>
              <span className="dashboard__hostsLiveRoomBarLabel">Room code</span>
              <code className="dashboard__hostsLiveRoomBarCode">
                {gameSession.joinCode}
              </code>
            </>
          ) : (
            <>
              <span className="dashboard__hostsLiveRoomBarLabel">room_id</span>
              <code className="dashboard__hostsLiveRoomBarCode">{roomId || '—'}</code>
            </>
          )}
          <span
            className={`dashboard__hostsLiveRoomGameStatus${gameSession?.started ? ' dashboard__hostsLiveRoomGameStatus--live' : ''}`}
          >
            {ROOM_PHASE_LABEL[roomPhase] ?? roomPhase}
          </span>
        </div>
      </header>

      <RoomStatusHeader
        roomPhase={roomPhase}
        guidance={guidance}
        progressLines={progressLines}
      />

      <div className="dashboard__hostsLiveRoomGrid">
        <aside className="dashboard__hostsLiveRoomMembers" aria-label="Participants">
          <h2 className="dashboard__hostsLiveRoomMembersTitle">
            Participants{members && members.length > 0 ? ` (${members.length})` : ''}
          </h2>
          <div
            className="dashboard__hostsLiveRoomMembersScroll"
            tabIndex={0}
            role="region"
            aria-label="Member list, scrollable"
          >
            {loadErr ? (
              <p className="dashboard__hostsLiveRoomMemberNote" role="alert">
                {loadErr}
              </p>
            ) : members === null ? (
              <p className="dashboard__hostsLiveRoomMemberNote">Loading members…</p>
            ) : members.length === 0 ? (
              <p className="dashboard__hostsLiveRoomMemberNote">
                No member data. Confirm booking and invitation records are saved to the database.
              </p>
            ) : (
              <>
                <p className="dashboard__hostsLiveRoomMemberNote dashboard__hostsLiveRoomMemberNote--compact">
                  Online members show a colored avatar; offline after ~45 seconds of inactivity.
                </p>
                <ul className="dashboard__hostsLiveRoomMemberList">
                  {members.map((m) => {
                    const isSelf = Boolean(
                      user?.id && m.clerkUserId && m.clerkUserId === user.id,
                    )
                    const onlineClass = m.isOnline ? 'is-online' : 'is-offline'
                    const memberVote =
                      m.clerkUserId && votingActive
                        ? memberVotesByUserId.get(m.clerkUserId)
                        : undefined
                    const presence = memberPresenceLabel(m)
                    return (
                      <li
                        key={`${m.role}:${m.email}:${m.clerkUserId ?? ''}`}
                        className={`dashboard__hostsLiveRoomMember ${onlineClass}${isSelf ? ' is-self' : ''}${votingActive ? ' has-vote-slot' : ''}`}
                      >
                        {m.imageUrl ? (
                          <img
                            src={m.imageUrl}
                            alt=""
                            className="dashboard__hostsLiveRoomMemberAvatarImg"
                            width={36}
                            height={36}
                            decoding="async"
                          />
                        ) : (
                          <span
                            className="dashboard__hostsLiveRoomMemberAvatarPh"
                            aria-hidden
                          >
                            {(m.displayId || '?').slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <div className="dashboard__hostsLiveRoomMemberBody">
                          <div className="dashboard__hostsLiveRoomMemberNameRow">
                            <span className="dashboard__hostsLiveRoomMemberId">
                              {m.displayId}
                              {isSelf ? ' (you)' : ''}
                            </span>
                            {m.role === 'host' && gameSession?.isHost && roomPhase === 'LOBBY' ? (
                              <button
                                type="button"
                                className="dashboard__hostsHostStartBtn"
                                disabled={gameStarting || !allReady}
                                onClick={() => void handleStartGame()}
                              >
                                {gameStarting
                                  ? 'Starting…'
                                  : allReady
                                    ? 'Start Game'
                                    : 'Waiting for players'}
                              </button>
                            ) : null}
                            {(roomPhase === 'LOBBY' || roomPhase === 'WISH_COLLECTION') &&
                            m.clerkUserId === user?.id ? (
                              <button
                                type="button"
                                className="dashboard__hostsHostStartBtn"
                                disabled={readyBusy}
                                onClick={() => void handleReadyToggle()}
                              >
                                {readyBusy
                                  ? '…'
                                  : gameSession?.selfReady
                                    ? 'Unready'
                                    : 'Ready'}
                              </button>
                            ) : null}
                            {roomPhase === 'WISH_COLLECTION' &&
                            gameSession?.isHost &&
                            m.role === 'host' ? (
                              <button
                                type="button"
                                className="dashboard__hostsHostStartBtn"
                                disabled={lockBusy}
                                onClick={() => void handleForceLock()}
                              >
                                {lockBusy ? 'Locking…' : 'Force lock'}
                              </button>
                            ) : null}
                            <span
                              className="dashboard__hostsLiveRoomMemberPresence"
                              title={presence.text}
                            >
                              {presence.emoji} {presence.text}
                            </span>
                          </div>
                          <div className="dashboard__hostsLiveRoomMemberTags">
                            <ReliabilityBadge reputation={m.reputation} />
                          </div>
                          {m.email && !m.email.startsWith('host:') ? (
                            <span className="dashboard__hostsLiveRoomMemberEmail" title={m.email}>
                              {m.email}
                            </span>
                          ) : null}
                          {m.role === 'host' ? (
                            <div className="dashboard__hostsLiveRoomMemberTags">
                              <span className="dashboard__hostsLiveRoomMemberTag">Host</span>
                            </div>
                          ) : null}
                        </div>
                        {votingActive ? (
                          <RoomMemberVoteBadge vote={memberVote} />
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </aside>

        <aside className="dashboard__hostsLiveRoomWishPool" aria-label="Wish pool">
          <h2 className="dashboard__hostsLiveRoomWishPoolTitle">Wish pool</h2>
          <div className="dashboard__hostsLiveRoomWishPoolVotes" aria-label="Approve or veto">
            {gameSession ? (
              <RoomCaseMemberVotes
                roomId={roomId}
                getToken={getToken}
                selfUserId={user?.id}
                gameTitle={lastGameTitle}
                session={gameSession}
                myVote={
                  user?.id && lastGameTitle
                    ? (memberVotesByUserId.get(user.id) ?? null)
                    : null
                }
                variant="wishPool"
                onVoteSubmitted={() => void reloadLive()}
              />
            ) : null}
          </div>
          <div className="dashboard__hostsLiveRoomWishPoolBody" role="region" aria-label="Wish pool content">
            <WishPoolGameSlots
              roomId={roomId}
              getToken={getToken}
              onSavedGameIdsChange={onSavedGameIdsChange}
              liveWishPool={liveWishPool}
              liveTick={liveTick}
              readOnly={wishLocked}
              onAfterSave={() => void reloadLive()}
            />
          </div>
        </aside>

        <main className="dashboard__hostsLiveRoomMain" aria-label="Main area">
          <div className="dashboard__hostsLiveRoomMainInner dashboard__hostsLiveRoomMainInner--case">
            <RoomCaseOpening
              roomId={roomId}
              getToken={getToken}
              selfUserId={user?.id}
              wishGameIds={wishGameIds}
              onLastResultChange={onLastResultChange}
              gameSession={gameSession}
              gameSessionLoadErr={loadErr}
              gameStartNotice={gameStartNotice}
              onDismissGameStartNotice={dismissStartNotice}
              isHost={gameSession?.isHost ?? false}
              onRoomEnded={onRoomEnded}
              onFsmSync={() => void reloadLive()}
            />
          </div>
        </main>
      </div>

      {finalReveal ? (
        <RoomGameFinalReveal
          game={finalReveal}
          onContinue={() => setFinalReveal(null)}
        />
      ) : null}
    </div>
  )
}
