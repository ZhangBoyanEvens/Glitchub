import { useAuth, useOrganization, useUser } from '@clerk/clerk-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clerkSelfDisplayId } from './clerkSelfDisplayId.ts'
import {
  fetchMyHostInvitations,
  type HostInvitationListItem,
} from './hostInvitationsListApi.ts'
import { HostsUserBadge } from './HostsUserBadge.tsx'
import { postJoinRoom } from './joinRoomApi.ts'
import { HostsBackBar } from './HostsBackBar'

function inviteeSummary(row: HostInvitationListItem): string {
  if (row.isHost) {
    const names = row.invitees
      .map((i) => i.displayName?.trim())
      .filter(Boolean)
    return names.length ? `Invitees: ${names.join(', ')}` : 'Invitees: —'
  }
  return 'Role: invitee'
}

function statusLabel(status: string | null): string {
  switch (status) {
    case 'confirmed':
      return 'Confirmed'
    case 'cancelled':
      return 'Cancelled'
    case 'pending':
      return 'Pending'
    default:
      return status ? status : '—'
  }
}

function canEnterRoom(row: HostInvitationListItem): boolean {
  const rid = row.roomId?.trim() ?? ''
  if (!rid.toLowerCase().startsWith('rm_')) return false
  if (row.appointmentStatus === 'cancelled') return false
  return true
}

export function DashboardHostsJoin() {
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()
  const { organization, isLoaded: orgLoaded } = useOrganization()
  const navigate = useNavigate()
  const orgId = organization?.id ?? ''

  const [roomInput, setRoomInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [records, setRecords] = useState<HostInvitationListItem[] | null>(null)
  const [recordsLoad, setRecordsLoad] = useState<'idle' | 'loading' | 'ok' | 'err'>(
    'idle',
  )
  const [recordsErr, setRecordsErr] = useState<string | null>(null)
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null)
  const [recordJoinErr, setRecordJoinErr] = useState<string | null>(null)

  useEffect(() => {
    if (!orgLoaded || !isLoaded || !user) {
      return
    }
    if (!orgId) {
      queueMicrotask(() => {
        setRecords([])
        setRecordsLoad('ok')
        setRecordsErr(null)
      })
      return
    }

    let cancelled = false
    queueMicrotask(() => {
      setRecordsLoad('loading')
      setRecordsErr(null)
    })

    void (async () => {
      try {
        const list = await fetchMyHostInvitations({ orgId, getToken })
        if (!cancelled) {
          setRecords(list)
          setRecordsLoad('ok')
        }
      } catch (e) {
        if (!cancelled) {
          setRecords([])
          setRecordsLoad('err')
          setRecordsErr(e instanceof Error ? e.message : String(e))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [orgId, orgLoaded, isLoaded, user, getToken])

  const enterRoom = useCallback(
    async (roomId: string) => {
      setRecordJoinErr(null)
      setJoiningRoomId(roomId)
      try {
        const out = await postJoinRoom(roomId, { getToken })
        navigate(`/dashboard/hosts/room/${encodeURIComponent(out.roomId)}`, {
          replace: false,
        })
      } catch (e) {
        setRecordJoinErr(e instanceof Error ? e.message : String(e))
      } finally {
        setJoiningRoomId(null)
      }
    },
    [getToken, navigate],
  )

  const onJoin = useCallback(async () => {
    setErr(null)
    const rid = roomInput.trim()
    if (!rid) {
      setErr('Enter a room ID (e.g. starting with rm_).')
      return
    }
    if (!rid.toLowerCase().startsWith('rm_')) {
      setErr('Invalid room ID format; it should start with rm_.')
      return
    }
    setBusy(true)
    try {
      const out = await postJoinRoom(rid, { getToken })
      navigate(`/dashboard/hosts/room/${encodeURIComponent(out.roomId)}`, {
        replace: false,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [getToken, navigate, roomInput])

  return (
    <section className="dashboard__panel dashboard__hostsSub dashboard__hostsSub--join">
      <HostsBackBar pageTitle="Join Room" />

      <div className="dashboard__hostsJoinLayout">
        <div className="dashboard__hostsJoinCard">
          <p className="dashboard__hostsJoinHint">
            Sign in with the Clerk account whose <strong>primary email matches the invitation</strong>.
            Only the host or invitees may enter. Confirm your profile email matches the invitation first.
          </p>
          {!isLoaded ? (
            <p className="dashboard__hostsBookMuted">Loading account…</p>
          ) : !user ? (
            <p className="dashboard__hostsBookErr" role="alert">
              Please sign in first.
            </p>
          ) : (
            <>
              <div className="dashboard__hostsJoinSelf">
                <HostsUserBadge
                  presence="outside_room"
                  imageUrl={user.imageUrl}
                  displayId={clerkSelfDisplayId(user)}
                  caption="Current account"
                />
              </div>
              <label className="dashboard__hostsJoinLabel" htmlFor="hosts-room-code">
                Room ID (room_id)
              </label>
              <input
                id="hosts-room-code"
                type="text"
                className="dashboard__hostsJoinInput"
                placeholder="e.g. rm_a1b2c3d4e5f6g7h8"
                maxLength={80}
                autoComplete="off"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                disabled={busy}
              />
              {err ? (
                <p className="dashboard__hostsBookErr" role="alert">
                  {err}
                </p>
              ) : null}
              <button
                type="button"
                className="dashboard__hostsJoinPrimary"
                disabled={busy || !roomInput.trim()}
                onClick={() => void onJoin()}
              >
                {busy ? 'Verifying…' : 'Join room'}
              </button>
            </>
          )}
        </div>
        <div className="dashboard__hostsJoinOr">or</div>
        <div className="dashboard__hostsJoinCard dashboard__hostsJoinCard--records">
          <h2 className="dashboard__hostsJoinRecordsTitle">Booking history</h2>
          {!orgLoaded ? (
            <p className="dashboard__hostsBookMuted">Loading organization…</p>
          ) : !orgId ? (
            <p className="dashboard__hostsBookMuted">
              Select or create an organization on the{' '}
              <Link to="/dashboard/organization" className="dashboard__hostsBookLink">
                Organization
              </Link>{' '}
              page to view bookings for this org.
            </p>
          ) : recordsLoad === 'loading' || recordsLoad === 'idle' ? (
            <p className="dashboard__hostsBookMuted">Loading bookings…</p>
          ) : recordsErr ? (
            <p className="dashboard__hostsBookErr" role="alert">
              {recordsErr}
            </p>
          ) : !records?.length ? (
            <p className="dashboard__hostsBookMuted">No bookings linked to your account.</p>
          ) : (
            <>
              {recordJoinErr ? (
                <p className="dashboard__hostsBookErr" role="alert">
                  {recordJoinErr}
                </p>
              ) : null}
              <ul className="dashboard__hostsJoinRecordsList">
                {records.map((row) => {
                  const rid = row.roomId?.trim() ?? ''
                  const enterOk = canEnterRoom(row)
                  const joining = joiningRoomId === rid && joiningRoomId.length > 0
                  return (
                    <li key={row.id} className="dashboard__hostsJoinRecordsRow">
                      <div className="dashboard__hostsJoinRecordsMain">
                        <span className="dashboard__hostsJoinRecordsWhen">
                          {row.dateISO} {row.timeStart}
                        </span>
                        <span className="dashboard__hostsJoinRecordsMeta">
                          {row.isHost ? 'Host' : 'Invitee'} ·{' '}
                          {statusLabel(row.appointmentStatus)}
                        </span>
                        <span className="dashboard__hostsJoinRecordsMeta">
                          {inviteeSummary(row)}
                        </span>
                        {rid ? (
                          <span className="dashboard__hostsJoinRecordsRoom">
                            {rid}
                          </span>
                        ) : (
                          <span className="dashboard__hostsJoinRecordsRoom dashboard__hostsJoinRecordsRoom--missing">
                            Room ID not generated
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="dashboard__hostsJoinRecordsEnter"
                        disabled={!enterOk || joining || joiningRoomId !== null}
                        onClick={() => void enterRoom(rid)}
                      >
                        {joining ? 'Joining…' : 'Join room'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
