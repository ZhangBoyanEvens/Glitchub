import { OrganizationSwitcher, useAuth, useOrganization } from '@clerk/clerk-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GameCoverImage } from './hosts/GameCoverImage.tsx'
import { resolveReferenceGameImageUrl } from './hosts/referenceGameImageUrls.ts'
import { resolveReferenceGamePrice } from './hosts/referenceGamePrices.ts'
import { resolveReferenceGameTags } from './hosts/referenceGameMeta.ts'
import { resolveReferenceGameSize } from './hosts/referenceGameSizes.ts'
import { resolveReferenceGameSteamStoreUrl } from './hosts/referenceGameSteam.ts'
import {
  createOrgProposal,
  fetchOrgGames,
  fetchOrgProposals,
  formatExpiresIn,
  voteOrgProposal,
  type OrgGame,
  type OrgProposal,
} from './orgGamesApi.ts'
import './orgGames.css'

function memberNameByUserId(
  memberships: { data?: ReadonlyArray<{ publicUserData?: { userId?: string; firstName?: string | null; lastName?: string | null; identifier?: string } }> } | null | undefined,
  userId: string,
): string {
  const m = memberships?.data?.find((x) => x.publicUserData?.userId === userId)
  const u = m?.publicUserData
  if (!u) return userId.slice(0, 8)
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
  return name || u.identifier || userId.slice(0, 8)
}

function OrgGameCover({ game }: { game: OrgGame }) {
  const [failed, setFailed] = useState(false)
  const src =
    game.imageUrl?.trim() ||
    resolveReferenceGameImageUrl({ title: game.gameName }) ||
    null
  if (!src || failed) {
    return (
      <div className="orgGames__cover">
        <GameCoverImage title={game.gameName} className="gameCover--card" />
      </div>
    )
  }

  return (
    <div className="orgGames__cover">
      <img
        className="orgGames__coverImg"
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function ProposalCard({
  proposal,
  memberLabel,
  onVoted,
  getToken,
}: {
  proposal: OrgProposal
  memberLabel: (id: string) => string
  onVoted: () => void
  getToken: () => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isPending = proposal.status === 'PENDING'

  const voteStatusLabel = useMemo(() => {
    if (!isPending) return null
    if (proposal.hasVoted) return 'You have voted'
    return 'Vote pending'
  }, [isPending, proposal.hasVoted])

  const submitVote = async (vote: 'APPROVE' | 'REJECT') => {
    setErr(null)
    setBusy(true)
    try {
      await voteOrgProposal(proposal.id, vote, { getToken })
      onVoted()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const typeLabel =
    proposal.proposalType === 'ADD_GAME' ? 'Add Game' : 'Remove Game'

  return (
    <article className="orgGames__proposalCard">
      <div className="orgGames__proposalHead">
        <span
          className={`orgGames__typeBadge orgGames__typeBadge--${proposal.proposalType === 'ADD_GAME' ? 'add' : 'remove'}`}
        >
          {typeLabel}
        </span>
        {!isPending && (
          <span className="orgGames__statusBadge">{proposal.status}</span>
        )}
      </div>
      <h3 className="orgGames__proposalTitle">{proposal.gameName}</h3>
      <p className="orgGames__proposalMeta">
        Proposer: {memberLabel(proposal.proposerUserId)}
      </p>
      {isPending ? (
        <p className="orgGames__proposalMeta">
          Time left: {formatExpiresIn(proposal.expiresInMs)}
        </p>
      ) : proposal.resolvedAt ? (
        <p className="orgGames__proposalMeta">
          Resolved: {new Date(proposal.resolvedAt).toLocaleString()}
        </p>
      ) : null}
      {isPending && voteStatusLabel && (
        <p className="orgGames__voteStatus">{voteStatusLabel}</p>
      )}
      {isPending && !proposal.hasVoted && (
        <div className="orgGames__voteActions">
          <button
            type="button"
            className="orgGames__btn orgGames__btn--approve"
            disabled={busy}
            onClick={() => void submitVote('APPROVE')}
          >
            Approve
          </button>
          <button
            type="button"
            className="orgGames__btn orgGames__btn--reject"
            disabled={busy}
            onClick={() => void submitVote('REJECT')}
          >
            Reject
          </button>
        </div>
      )}
      {isPending && proposal.hasVoted && (
        <p className="orgGames__voteSubmitted">Vote submitted.</p>
      )}
      {err && (
        <p className="orgGames__error" role="alert">
          {err}
        </p>
      )}
    </article>
  )
}

export function DashboardOrgGames() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  if (!publishableKey) {
    return (
      <section className="dashboard__panel">
        <h1 className="dashboard__panelTitle">Organization Games</h1>
        <p className="dashboard__missing">
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>.env</code>.
        </p>
      </section>
    )
  }
  return <DashboardOrgGamesInner />
}

function DashboardOrgGamesInner() {
  const { getToken } = useAuth()
  const { isLoaded, organization, memberships } = useOrganization({
    memberships: { pageSize: 50, keepPreviousData: true },
  })

  const [games, setGames] = useState<OrgGame[]>([])
  const [pending, setPending] = useState<OrgProposal[]>([])
  const [resolved, setResolved] = useState<OrgProposal[]>([])
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [proposalTab, setProposalTab] = useState<'pending' | 'resolved'>('pending')

  const [addModalOpen, setAddModalOpen] = useState(false)
  const [removeModalOpen, setRemoveModalOpen] = useState(false)
  const [removeGameId, setRemoveGameId] = useState('')
  const [formName, setFormName] = useState('')
  const [formSteam, setFormSteam] = useState('')
  const [formImage, setFormImage] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeErr, setRemoveErr] = useState<string | null>(null)

  const orgId = organization?.id ?? null

  const memberLabel = useCallback(
    (userId: string) => memberNameByUserId(memberships, userId),
    [memberships],
  )

  const reload = useCallback(async () => {
    if (!orgId) return
    setLoadState('loading')
    setErrMsg(null)
    try {
      const [g, p] = await Promise.all([
        fetchOrgGames(orgId, { getToken }),
        fetchOrgProposals(orgId, { getToken }),
      ])
      setGames(g)
      setPending(p.pending)
      setResolved(p.resolved)
      setLoadState('ok')
    } catch (e: unknown) {
      setLoadState('err')
      setErrMsg(e instanceof Error ? e.message : String(e))
    }
  }, [orgId, getToken])

  useEffect(() => {
    if (!isLoaded) return
    if (!orgId) {
      setGames([])
      setPending([])
      setResolved([])
      setLoadState('idle')
      return
    }
    void reload()
  }, [isLoaded, orgId, reload])

  const submitAddProposal = async () => {
    if (!orgId) return
    setFormErr(null)
    setFormBusy(true)
    try {
      await createOrgProposal(
        {
          orgId,
          proposalType: 'ADD_GAME',
          gameName: formName.trim(),
          steamUrl: formSteam.trim() || undefined,
          imageUrl: formImage.trim() || undefined,
        },
        { getToken },
      )
      setAddModalOpen(false)
      setFormName('')
      setFormSteam('')
      setFormImage('')
      await reload()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('DUPLICATE')) {
        setFormErr('A game with this name or a pending proposal already exists in this organization.')
      } else {
        setFormErr(msg)
      }
    } finally {
      setFormBusy(false)
    }
  }

  const pendingRemovalGameIds = useMemo(() => {
    const ids = new Set<string>()
    for (const p of pending) {
      if (p.proposalType === 'REMOVE_GAME' && p.targetGameId) {
        ids.add(p.targetGameId)
      }
    }
    return ids
  }, [pending])

  const submitRemoveProposal = async (game: OrgGame) => {
    if (!orgId) return
    setRemoveErr(null)
    setRemoveBusy(true)
    try {
      await createOrgProposal(
        {
          orgId,
          proposalType: 'REMOVE_GAME',
          gameName: game.gameName,
          targetGameId: game.id,
        },
        { getToken },
      )
      setRemoveModalOpen(false)
      setRemoveGameId('')
      await reload()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('DUPLICATE_PENDING_REMOVAL')) {
        setRemoveErr('This game already has a pending removal proposal.')
      } else {
        setRemoveErr(msg)
      }
    } finally {
      setRemoveBusy(false)
    }
  }

  const submitRemoveFromModal = async () => {
    const game = games.find((g) => g.id === removeGameId)
    if (!game) {
      setRemoveErr('Select a game to remove.')
      return
    }
    if (pendingRemovalGameIds.has(game.id)) {
      setRemoveErr('This game already has a pending removal proposal.')
      return
    }
    await submitRemoveProposal(game)
  }

  if (!isLoaded) {
    return (
      <section className="dashboard__panel orgGames">
        <p className="dashboard__gamesStatus">Loading organization…</p>
      </section>
    )
  }

  if (!organization) {
    return (
      <section className="dashboard__panel orgGames">
        <h1 className="dashboard__panelTitle">Organization Games</h1>
        <p className="orgGames__hint">Select or create a Clerk organization first.</p>
        <OrganizationSwitcher hidePersonal />
      </section>
    )
  }

  const shownProposals = proposalTab === 'pending' ? pending : resolved

  return (
    <section className="dashboard__panel orgGames">
      <header className="orgGames__header">
        <div className="orgGames__headerText">
          <h1 className="dashboard__panelTitle">Organization Games</h1>
          <p className="orgGames__hint">
            Organization game library and proposal voting (blind vote, 24 hours). See the global reference catalog at{' '}
            <Link to="/dashboard/catalog">Catalog</Link>.
          </p>
        </div>
        <div className="orgGames__headerActions">
          <div className="orgGames__headerButtons">
            <button
              type="button"
              className="orgGames__btn orgGames__btn--outlineDanger orgGames__removalHeaderBtn"
              disabled={games.length === 0}
              onClick={() => {
                setRemoveErr(null)
                setRemoveGameId('')
                setRemoveModalOpen(true)
              }}
            >
              Removal
            </button>
            <button
              type="button"
              className="orgGames__btn orgGames__btn--primary orgGames__newGameBtn"
              onClick={() => {
                setFormErr(null)
                setAddModalOpen(true)
              }}
            >
              New Game
            </button>
          </div>
          <OrganizationSwitcher hidePersonal />
        </div>
      </header>

      {loadState === 'loading' && (
        <p className="dashboard__gamesStatus">Loading…</p>
      )}
      {loadState === 'err' && errMsg && (
        <p className="dashboard__gamesError" role="alert">
          {errMsg}
        </p>
      )}

      <section className="orgGames__proposalsSection" aria-labelledby="org-proposals-heading">
        <h2 id="org-proposals-heading" className="orgGames__sectionTitle">
          Game Proposals
        </h2>
        <div className="orgGames__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={proposalTab === 'pending'}
            className={`orgGames__tab${proposalTab === 'pending' ? ' is-active' : ''}`}
            onClick={() => setProposalTab('pending')}
          >
            Pending ({pending.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={proposalTab === 'resolved'}
            className={`orgGames__tab${proposalTab === 'resolved' ? ' is-active' : ''}`}
            onClick={() => setProposalTab('resolved')}
          >
            Resolved ({resolved.length})
          </button>
        </div>
        {shownProposals.length === 0 ? (
          <p className="orgGames__hint">No {proposalTab === 'pending' ? 'pending' : 'resolved'} proposals.</p>
        ) : (
          <div className="orgGames__proposalGrid">
            {shownProposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                memberLabel={memberLabel}
                getToken={getToken}
                onVoted={() => void reload()}
              />
            ))}
          </div>
        )}
      </section>

      {loadState === 'ok' && games.length === 0 && (
        <p className="orgGames__hint">No games in the library yet. Use New Game to submit an add proposal.</p>
      )}

      {games.length > 0 && (
        <div className="orgGames__libraryGrid">
          {games.map((g) => {
            const ref = { title: g.gameName }
            const tags = resolveReferenceGameTags(ref)
            const price = resolveReferenceGamePrice(ref)
            const size = resolveReferenceGameSize(ref)
            const steamUrl =
              g.steamUrl?.trim() ||
              resolveReferenceGameSteamStoreUrl(ref) ||
              null
            return (
              <article key={g.id} className="dashboard__gameCard orgGames__gameCard">
                <OrgGameCover game={g} />
                <div className="dashboard__gameBody orgGames__gameBody">
                  <h2 className="dashboard__gameTitle">{g.gameName}</h2>
                  <dl className="dashboard__gameMeta">
                    <div className="dashboard__gameMetaRow">
                      <dt>Tag</dt>
                      <dd>
                        {tags.length > 0 ? (
                          <span className="dashboard__gameTagList">
                            {tags.map((tag) => (
                              <span key={tag} className="dashboard__gameTag">
                                {tag}
                              </span>
                            ))}
                          </span>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div className="dashboard__gameMetaRow">
                      <dt>Price</dt>
                      <dd>{price?.label ?? '—'}</dd>
                    </div>
                    <div className="dashboard__gameMetaRow">
                      <dt>Size</dt>
                      <dd>{size?.label ?? '—'}</dd>
                    </div>
                  </dl>
                  {steamUrl ? (
                    <a
                      className="orgGames__steamLink"
                      href={steamUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Steam
                    </a>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {removeModalOpen && (
        <div
          className="orgGames__modalBackdrop"
          role="presentation"
          onClick={() => !removeBusy && setRemoveModalOpen(false)}
        >
          <div
            className="orgGames__modal"
            role="dialog"
            aria-labelledby="remove-game-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="remove-game-dialog-title" className="orgGames__modalTitle">
              Request Removal
            </h2>
            <p className="orgGames__modalHint">
              Select a game to remove from the organization library. Submissions enter a 24-hour blind vote.
            </p>
            {games.length === 0 ? (
              <p className="orgGames__hint">No games in the organization library.</p>
            ) : (
              <label className="orgGames__field">
                <span>Game</span>
                <select
                  className="orgGames__select"
                  value={removeGameId}
                  onChange={(e) => setRemoveGameId(e.target.value)}
                  autoFocus
                >
                  <option value="">— Select —</option>
                  {[...games]
                    .sort((a, b) => a.gameName.localeCompare(b.gameName, 'en'))
                    .map((g) => (
                      <option
                        key={g.id}
                        value={g.id}
                        disabled={pendingRemovalGameIds.has(g.id)}
                      >
                        {g.gameName}
                        {pendingRemovalGameIds.has(g.id) ? ' (pending proposal)' : ''}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {removeErr && (
              <p className="orgGames__error" role="alert">
                {removeErr}
              </p>
            )}
            <div className="orgGames__modalActions">
              <button
                type="button"
                className="orgGames__btn orgGames__btn--ghost"
                disabled={removeBusy}
                onClick={() => setRemoveModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="orgGames__btn orgGames__btn--outlineDanger"
                disabled={
                  removeBusy ||
                  games.length === 0 ||
                  !removeGameId ||
                  pendingRemovalGameIds.has(removeGameId)
                }
                onClick={() => void submitRemoveFromModal()}
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {addModalOpen && (
        <div
          className="orgGames__modalBackdrop"
          role="presentation"
          onClick={() => !formBusy && setAddModalOpen(false)}
        >
          <div
            className="orgGames__modal"
            role="dialog"
            aria-labelledby="new-game-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="new-game-dialog-title" className="orgGames__modalTitle">
              New Game
            </h2>
            <label className="orgGames__field">
              <span>Game name *</span>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label className="orgGames__field">
              <span>Steam URL</span>
              <input
                value={formSteam}
                onChange={(e) => setFormSteam(e.target.value)}
                placeholder="https://store.steampowered.com/..."
              />
            </label>
            <label className="orgGames__field">
              <span>Cover image URL</span>
              <input
                value={formImage}
                onChange={(e) => setFormImage(e.target.value)}
                placeholder="https://..."
              />
            </label>
            {formErr && (
              <p className="orgGames__error" role="alert">
                {formErr}
              </p>
            )}
            <div className="orgGames__modalActions">
              <button
                type="button"
                className="orgGames__btn orgGames__btn--ghost"
                disabled={formBusy}
                onClick={() => setAddModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="orgGames__btn orgGames__btn--primary"
                disabled={formBusy || !formName.trim()}
                onClick={() => void submitAddProposal()}
              >
                Submit Proposal
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
