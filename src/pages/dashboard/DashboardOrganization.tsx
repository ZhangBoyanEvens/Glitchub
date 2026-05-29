import {
  CreateOrganization,
  OrganizationSwitcher,
  useOrganization,
} from '@clerk/clerk-react'
import { useCallback, useState } from 'react'
import './organization.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function memberDisplayName(m: {
  publicUserData?: {
    firstName?: string | null
    lastName?: string | null
    identifier?: string
  }
}) {
  const u = m.publicUserData
  if (!u) return 'Member'
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
  return name || u.identifier || 'Member'
}

export function DashboardOrganization() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

  if (!publishableKey) {
    return (
      <section className="dashboard__panel">
        <h1 className="dashboard__panelTitle">Organization</h1>
        <p className="dashboard__missing">
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>.env</code>.
        </p>
      </section>
    )
  }

  return <DashboardOrganizationInner />
}

function DashboardOrganizationInner() {
  const { isLoaded, organization, memberships, invitations } = useOrganization(
    {
      memberships: { pageSize: 50, keepPreviousData: true },
      invitations: { pageSize: 30 },
    },
  )

  const [inviteInput, setInviteInput] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<string | null>(null)
  const [inviteErr, setInviteErr] = useState<string | null>(null)

  const sendInvite = useCallback(async () => {
    setInviteMsg(null)
    setInviteErr(null)
    if (!organization) {
      setInviteErr('Select or create an organization first.')
      return
    }
    const raw = inviteInput.trim()
    if (!raw) {
      setInviteErr('Enter a friend\'s email address.')
      return
    }
    if (!EMAIL_RE.test(raw)) {
      setInviteErr(
        'Clerk invitations require a full email address. If you only know the other person\'s username, ask them to add an email to their Clerk account, then invite using that email.',
      )
      return
    }
    setInviteBusy(true)
    try {
      await organization.inviteMember({
        emailAddress: raw.toLowerCase(),
        role: 'org:member',
      })
      setInviteInput('')
      setInviteMsg('Invitation sent. They will receive a join link by email.')
      await Promise.all([
        invitations?.revalidate?.() ?? Promise.resolve(),
        memberships?.revalidate?.() ?? Promise.resolve(),
      ])
    } catch (e: unknown) {
      const err = e as {
        errors?: Array<{ longMessage?: string; message?: string }>
        message?: string
      }
      const line =
        err?.errors?.[0]?.longMessage ??
        err?.errors?.[0]?.message ??
        err?.message ??
        'Invitation failed. Confirm you have invite permissions and the email has not already been invited.'
      setInviteErr(line)
    } finally {
      setInviteBusy(false)
    }
  }, [organization, inviteInput, invitations])

  if (!isLoaded) {
    return (
      <section className="dashboard__panel dashboard__org dashboard__org--split dashboard__org--stateLoading">
        <p className="dashboard__orgLoading">Loading organization…</p>
      </section>
    )
  }

  if (!organization) {
    return (
      <section className="dashboard__panel dashboard__org dashboard__org--split dashboard__org--stateEmpty">
        <h1 className="dashboard__panelTitle">Organization</h1>
        <p className="dashboard__panelLead">
          Select an existing organization below, or create a new one. Enable Organizations in the{' '}
          <a
            href="https://dashboard.clerk.com"
            target="_blank"
            rel="noreferrer"
            className="dashboard__orgLink"
          >
            Clerk Dashboard
          </a>
          .
        </p>
        <div className="dashboard__orgEmpty">
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/dashboard/organization"
            afterSelectOrganizationUrl="/dashboard/organization"
          />
          <div className="dashboard__orgCreateWrap">
            <CreateOrganization
              routing="hash"
              afterCreateOrganizationUrl="/dashboard/organization"
            />
          </div>
        </div>
      </section>
    )
  }

  const members = memberships?.data ?? []
  const pendingInv = (invitations?.data ?? []).filter((i) => i.status === 'pending')

  return (
    <section
      className="dashboard__panel dashboard__org dashboard__org--split"
      aria-label="Organization"
    >
      <div className="dashboard__orgLayout">
        <aside className="dashboard__orgMembers" aria-label="Organization members">
          <h2 className="dashboard__orgMembersTitle">Members</h2>
          {memberships?.isLoading ? (
            <p className="dashboard__orgMuted">Loading members…</p>
          ) : members.length === 0 ? (
            <p className="dashboard__orgMuted">No member data</p>
          ) : (
            <ul className="dashboard__orgMemberList">
              {members.map((m) => (
                <li key={m.id} className="dashboard__orgMemberRow">
                  {m.publicUserData?.imageUrl ? (
                    <img
                      src={m.publicUserData.imageUrl}
                      alt=""
                      className="dashboard__orgMemberAvatar"
                      width={40}
                      height={40}
                    />
                  ) : (
                    <div className="dashboard__orgMemberAvatar dashboard__orgMemberAvatar--ph" />
                  )}
                  <div className="dashboard__orgMemberText">
                    <span className="dashboard__orgMemberName">
                      {memberDisplayName(m)}
                    </span>
                    <span className="dashboard__orgMemberRole">{m.roleName}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="dashboard__orgRight">
          <section className="dashboard__orgInvite" aria-label="Invite friends">
            <h2 className="dashboard__orgSectionTitle">Invite Friends</h2>
            <div className="dashboard__orgInviteRow">
              <input
                type="text"
                className="dashboard__orgInviteInput"
                placeholder="friend@example.com"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                disabled={inviteBusy}
                autoComplete="off"
              />
              <button
                type="button"
                className="dashboard__orgInviteBtn"
                disabled={inviteBusy}
                onClick={() => void sendInvite()}
              >
                {inviteBusy ? 'Sending…' : 'Send Invitation'}
              </button>
            </div>
            {inviteMsg ? (
              <p className="dashboard__orgInviteOk" role="status">
                {inviteMsg}
              </p>
            ) : null}
            {inviteErr ? (
              <p className="dashboard__orgInviteErr" role="alert">
                {inviteErr}
              </p>
            ) : null}
            {pendingInv.length > 0 ? (
              <div className="dashboard__orgPending">
                <span className="dashboard__orgPendingLabel">Pending invitations</span>
                <ul className="dashboard__orgPendingList">
                  {pendingInv.map((inv) => (
                    <li key={inv.id} className="dashboard__orgPendingItem">
                      {inv.emailAddress}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="dashboard__orgOverview" aria-label="Organization overview">
            <div className="dashboard__orgOverviewTop">
              <h2 className="dashboard__orgSectionTitle">Organization Overview</h2>
              <OrganizationSwitcher
                hidePersonal
                afterCreateOrganizationUrl="/dashboard/organization"
                afterSelectOrganizationUrl="/dashboard/organization"
              />
            </div>
            <div className="dashboard__orgOverviewGrid">
              <div className="dashboard__orgStat">
                <span className="dashboard__orgStatLabel">Name</span>
                <span className="dashboard__orgStatValue">{organization.name}</span>
              </div>
              <div className="dashboard__orgStat">
                <span className="dashboard__orgStatLabel">Slug</span>
                <span className="dashboard__orgStatValue">
                  {organization.slug ?? '—'}
                </span>
              </div>
              <div className="dashboard__orgStat">
                <span className="dashboard__orgStatLabel">Members</span>
                <span className="dashboard__orgStatValue">
                  {organization.membersCount}
                </span>
              </div>
              <div className="dashboard__orgStat">
                <span className="dashboard__orgStatLabel">Pending invitations</span>
                <span className="dashboard__orgStatValue">
                  {organization.pendingInvitationsCount}
                </span>
              </div>
              <div className="dashboard__orgStat dashboard__orgStat--wide">
                <span className="dashboard__orgStatLabel">Created</span>
                <span className="dashboard__orgStatValue">
                  {organization.createdAt.toLocaleString('en')}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
