import { useAuth, useOrganization, useUser } from '@clerk/clerk-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { sendHostBookingInvite } from './hostBookingInvite.ts'
import {
  emailFromMemberIdentifier,
  sendHostInvitationResendEmails,
} from './hostInvitationResendApi.ts'
import { appendBooking, type HostBookingRecord } from './hostBookingStorage.ts'
import { HostsBackBar } from './HostsBackBar'

const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

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

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function toDateISO(y: number, m0: number, day: number) {
  return `${y}-${pad2(m0 + 1)}-${pad2(day)}`
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function isPastLocalDay(y: number, m0: number, day: number) {
  const t = startOfLocalDay(new Date()).getTime()
  const c = startOfLocalDay(new Date(y, m0, day)).getTime()
  return c < t
}

function sameLocalDay(
  y: number,
  m0: number,
  day: number,
  ref: { y: number; m0: number; day: number },
) {
  return y === ref.y && m0 === ref.m0 && day === ref.day
}

function buildMonthGrid(year: number, month0: number) {
  const first = new Date(year, month0, 1)
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month0 + 1, 0).getDate()
  const cells: Array<{ kind: 'pad' } | { kind: 'day'; day: number }> = []
  for (let i = 0; i < lead; i++) cells.push({ kind: 'pad' })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ kind: 'day', day: d })
  return cells
}

function timeSlots(): string[] {
  const out: string[] = []
  for (let h = 8; h <= 23; h++) {
    for (const m of [0, 30]) {
      if (h === 23 && m === 30) break
      out.push(`${pad2(h)}:${pad2(m)}`)
    }
  }
  return out
}

const SLOT_OPTIONS = timeSlots()

function randomId() {
  return `hb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function DashboardHostsBook() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const { isLoaded, organization, memberships } = useOrganization({
    memberships: { pageSize: 100, keepPreviousData: true },
  })

  const now = new Date()
  const [viewY, setViewY] = useState(now.getFullYear())
  const [viewM0, setViewM0] = useState(now.getMonth())
  const [picked, setPicked] = useState(() => ({
    y: now.getFullYear(),
    m0: now.getMonth(),
    day: now.getDate(),
  }))
  const [timeStart, setTimeStart] = useState('19:00')
  const [selectedInviteeIds, setSelectedInviteeIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [inviteeFilter, setInviteeFilter] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formMsg, setFormMsg] = useState<string | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)

  const orgId = organization?.id

  const members = memberships?.data ?? []
  const selfId = user?.id

  const inviteCandidates = useMemo(() => {
    return members.filter((m) => m.publicUserData?.userId !== selfId)
  }, [members, selfId])

  const filteredInvitees = useMemo(() => {
    const q = inviteeFilter.trim().toLowerCase()
    if (!q) return inviteCandidates
    return inviteCandidates.filter((m) =>
      memberDisplayName(m).toLowerCase().includes(q),
    )
  }, [inviteCandidates, inviteeFilter])

  const grid = useMemo(
    () => buildMonthGrid(viewY, viewM0),
    [viewY, viewM0],
  )

  const selectedDateISO = useMemo(
    () => toDateISO(picked.y, picked.m0, picked.day),
    [picked],
  )

  const goPrevMonth = () => {
    setViewM0((m) => {
      if (m === 0) {
        setViewY((y) => y - 1)
        return 11
      }
      return m - 1
    })
  }

  const goNextMonth = () => {
    setViewM0((m) => {
      if (m === 11) {
        setViewY((y) => y + 1)
        return 0
      }
      return m + 1
    })
  }

  const toggleInvitee = (id: string) => {
    setSelectedInviteeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onSubmitInvite = async () => {
    setFormMsg(null)
    setFormErr(null)
    if (!organization || !orgId || !selfId) {
      setFormErr('Select an organization first.')
      return
    }
    if (isPastLocalDay(picked.y, picked.m0, picked.day)) {
      setFormErr('Select today or a future date.')
      return
    }
    if (selectedInviteeIds.size === 0) {
      setFormErr('Select at least one organization member to invite.')
      return
    }

    const inviteeIds: string[] = []
    const inviteeNames: string[] = []
    for (const m of members) {
      const uid = m.publicUserData?.userId
      if (uid && selectedInviteeIds.has(uid)) {
        inviteeIds.push(uid)
        inviteeNames.push(memberDisplayName(m))
      }
    }

    const invitees = inviteeIds.map((id) => {
      const m = members.find((x) => x.publicUserData?.userId === id)
      const u = m?.publicUserData
      const identifier = u?.identifier
      return {
        clerkUserId: id,
        displayName: m ? memberDisplayName(m) : 'Member',
        firstName: u?.firstName,
        lastName: u?.lastName,
        identifier,
        email: emailFromMemberIdentifier(identifier),
      }
    })

    const apiBody = {
      orgId,
      hostUserId: selfId,
      dateISO: selectedDateISO,
      timeStart,
      hostProfile: {
        firstName: user?.firstName,
        lastName: user?.lastName,
        identifier:
          user?.primaryEmailAddress?.emailAddress ?? user?.username ?? undefined,
      },
      invitees,
    }

    setSubmitting(true)
    try {
      const remote = await sendHostBookingInvite(apiBody, { getToken })
      const row: HostBookingRecord = {
        id: randomId(),
        orgId,
        hostUserId: selfId,
        dateISO: selectedDateISO,
        timeStart,
        inviteeIds,
        inviteeNames,
        createdAt: new Date().toISOString(),
        ...(remote.neonInvitationId
          ? { neonInvitationId: remote.neonInvitationId }
          : {}),
      }
      appendBooking(orgId, row)

      let emailLine = ''
      if (remote.neonInvitationId) {
        const recipients = invitees
          .map((inv) => {
            const em = emailFromMemberIdentifier(inv.identifier)
            if (!em) return null
            return { email: em, displayName: inv.displayName }
          })
          .filter((x): x is { email: string; displayName: string } => x !== null)
        if (recipients.length > 0) {
          try {
            const mail = await sendHostInvitationResendEmails(
              {
                invitationId: remote.neonInvitationId,
                recipients,
              },
              { getToken },
            )
            if (mail.skipped) {
              emailLine = ' Resend is not configured; no email was sent.'
            } else if (mail.failed > 0) {
              emailLine = ` Email send attempted: ${mail.sent} succeeded, ${mail.failed} failed.`
            } else {
              emailLine = ` Invitation email sent via Resend to ${mail.sent} address(es).`
            }
          } catch (emErr) {
            emailLine = ` Email send incomplete: ${emErr instanceof Error ? emErr.message : String(emErr)}`
          }
        } else {
          emailLine =
            ' Invitees did not provide a recognizable email (identifier must be a full email); no email sent.'
        }
      }

      setFormMsg(
        (remote.neonInvitationId
          ? 'Booking saved to Neon; local record synced.'
          : 'Booking saved locally; cloud write failed (check DATABASE_URL).') +
          emailLine,
      )
      setSelectedInviteeIds(new Set())
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Send failed. Please try again later.'
      setFormErr(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (!isLoaded) {
    return (
      <section className="dashboard__panel dashboard__hostsSub dashboard__hostsSub--book">
        <HostsBackBar pageTitle="Book a Room" />
        <p className="dashboard__hostsBookState">Loading…</p>
      </section>
    )
  }

  if (!organization) {
    return (
      <section className="dashboard__panel dashboard__hostsSub dashboard__hostsSub--book">
        <HostsBackBar pageTitle="Book a Room" />
        <p className="dashboard__hostsBookState">
          Bookings are sent to organization members. Select or create an organization on the{' '}
          <Link to="/dashboard/organization" className="dashboard__hostsBookLink">
            Organization
          </Link>{' '}
          page first.
        </p>
      </section>
    )
  }

  const monthTitle = `${viewY}-${pad2(viewM0 + 1)}`

  return (
    <>
      <section className="dashboard__panel dashboard__hostsSub dashboard__hostsSub--book">
        <HostsBackBar pageTitle="Book a Room" />

        <div className="dashboard__hostsBookLayout">
          <div className="dashboard__hostsBookSide">
            <h2 className="dashboard__hostsPageH2">Select date</h2>
            <p className="dashboard__hostsPageLead">
              Pick a day on the calendar (past dates are disabled); set time and invitees on the right.
            </p>

            <div className="dashboard__hostsBookCalWrap">
              <div className="dashboard__hostsBookCalNav">
              <button
                type="button"
                className="dashboard__hostsBookCalNavBtn"
                onClick={goPrevMonth}
                aria-label="Previous month"
              >
                ‹
              </button>
              <span className="dashboard__hostsBookCalTitle">{monthTitle}</span>
              <button
                type="button"
                className="dashboard__hostsBookCalNavBtn"
                onClick={goNextMonth}
                aria-label="Next month"
              >
                ›
              </button>
            </div>

            <div
              className="dashboard__hostsBookCalendar"
              role="grid"
              aria-label="Booking date"
            >
              {WEEK_LABELS.map((d) => (
                <span key={d} className="dashboard__hostsBookCalCell">
                  {d}
                </span>
              ))}
              {grid.map((cell, idx) => {
                if (cell.kind === 'pad') {
                  return (
                    <span
                      key={`pad-${idx}`}
                      className="dashboard__hostsBookCalPad"
                      aria-hidden
                    />
                  )
                }
                const { day } = cell
                const past = isPastLocalDay(viewY, viewM0, day)
                const weekend = (idx % 7 === 5 || idx % 7 === 6) && !past
                const selected = sameLocalDay(viewY, viewM0, day, picked)
                const today = sameLocalDay(
                  viewY,
                  viewM0,
                  day,
                  {
                    y: now.getFullYear(),
                    m0: now.getMonth(),
                    day: now.getDate(),
                  },
                )
                const cls = [
                  'dashboard__hostsBookCalDay',
                  past ? 'dashboard__hostsBookCalDay--past' : '',
                  !past && weekend ? 'dashboard__hostsBookCalDay--weekend' : '',
                  selected ? 'dashboard__hostsBookCalDay--selected' : '',
                  today ? 'dashboard__hostsBookCalDay--today' : '',
                ]
                  .filter(Boolean)
                  .join(' ')

                if (past) {
                  return (
                    <span key={day} className={cls} aria-disabled>
                      {day}
                    </span>
                  )
                }

                return (
                  <button
                    key={day}
                    type="button"
                    className={cls}
                    onClick={() =>
                      setPicked({ y: viewY, m0: viewM0, day })
                    }
                    aria-pressed={selected}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="dashboard__hostsBookMain">
          <div className="dashboard__hostsBookFormBlock" aria-labelledby="hosts-book-time-heading">
            <h3 className="dashboard__hostsBookSectionTitle" id="hosts-book-time-heading">
              Booking time
            </h3>
            <div
              className="dashboard__hostsBookDateTimeRow"
              role="group"
              aria-label="Selected date and start time"
            >
              <span className="dashboard__hostsPhLabel dashboard__hostsPhLabel--row">
                Selected date
              </span>
              <p className="dashboard__hostsBookSelectedDate dashboard__hostsBookSelectedDate--row">
                {selectedDateISO}
              </p>
              <label
                className="dashboard__hostsPhLabel dashboard__hostsPhLabel--row"
                htmlFor="host-book-time"
              >
                Start time
              </label>
              <select
                id="host-book-time"
                className="dashboard__hostsBookSelect dashboard__hostsBookSelect--row"
                value={timeStart}
                onChange={(e) => setTimeStart(e.target.value)}
              >
                {SLOT_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="dashboard__hostsBookFormBlock">
            <span className="dashboard__hostsPhLabel">Invitees (same org)</span>
            <input
              type="search"
              className="dashboard__hostsBookSearch"
              placeholder="Filter members…"
              value={inviteeFilter}
              onChange={(e) => setInviteeFilter(e.target.value)}
              autoComplete="off"
            />
            {memberships?.isLoading ? (
              <p className="dashboard__hostsBookMuted">Loading members…</p>
            ) : inviteCandidates.length === 0 ? (
              <p className="dashboard__hostsBookMuted">
                No other members to invite (or you are the only member). Invite more members on the Organization page.
              </p>
            ) : (
              <ul className="dashboard__hostsBookInviteList" role="list">
                {filteredInvitees.map((m) => {
                  const uid = m.publicUserData?.userId
                  if (!uid) return null
                  const on = selectedInviteeIds.has(uid)
                  return (
                    <li key={m.id}>
                      <label className="dashboard__hostsBookInviteRow">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleInvitee(uid)}
                        />
                        <span className="dashboard__hostsBookInviteName">
                          {memberDisplayName(m)}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>

      <div className="dashboard__hostsBookSubmitBar">
        <div className="dashboard__hostsBookActions">
          <button
            type="button"
            className="dashboard__hostsBookPrimary"
            disabled={
              submitting ||
              selectedInviteeIds.size === 0 ||
              isPastLocalDay(picked.y, picked.m0, picked.day)
            }
            onClick={() => void onSubmitInvite()}
          >
            {submitting ? 'Processing…' : 'Send booking invite'}
          </button>
        </div>
        {formMsg ? (
          <p className="dashboard__hostsBookOk" role="status">
            {formMsg}
          </p>
        ) : null}
        {formErr ? (
          <p className="dashboard__hostsBookErr" role="alert">
            {formErr}
          </p>
        ) : null}
      </div>
    </>
  )
}
