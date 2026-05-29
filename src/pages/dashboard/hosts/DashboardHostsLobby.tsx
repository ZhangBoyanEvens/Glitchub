import { useAuth } from '@clerk/clerk-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HostsBackBar } from './HostsBackBar'
import {
  postInstantRoomEnter,
  suggestInstantJoinCode,
} from './instantRoomApi.ts'

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}

export function DashboardHostsLobby() {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const codeLen = joinCode.length
  const canEnter = codeLen >= 4 && codeLen <= 6 && !busy

  const handleEnter = useCallback(async () => {
    if (!canEnter) return
    setBusy(true)
    setErr(null)
    try {
      const out = await postInstantRoomEnter(joinCode, { getToken })
      navigate(`/dashboard/hosts/room/${encodeURIComponent(out.roomId)}`, {
        replace: true,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [canEnter, joinCode, getToken, navigate])

  const handleSuggest = useCallback(async () => {
    setSuggesting(true)
    setErr(null)
    try {
      const code = await suggestInstantJoinCode({ getToken })
      setJoinCode(code)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSuggesting(false)
    }
  }, [getToken])

  return (
    <section className="dashboard__panel dashboard__hostsSub dashboard__hostsSub--lobby">
      <HostsBackBar pageTitle="Instant Lobby" />

      <p className="dashboard__hostsLobbyLead">
        Agree on the same 4–6 digit code with people nearby and enter it to join the same room. The first person to create that code becomes host. The room dissolves automatically when everyone leaves.
      </p>

      <div className="dashboard__hostsLobbyTop">
        <label className="dashboard__hostsSearch" htmlFor="instant-join-code">
          <span className="dashboard__hostsSearchIcon" aria-hidden>
            #
          </span>
          <input
            id="instant-join-code"
            className="dashboard__hostsSearchInput dashboard__hostsSearchInput--code"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="Enter 4–6 digit room code"
            value={joinCode}
            disabled={busy}
            onChange={(e) => setJoinCode(digitsOnly(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleEnter()
            }}
          />
        </label>

        <div className="dashboard__hostsLobbyActions">
          <button
            type="button"
            className="dashboard__hostsLobbyBtn dashboard__hostsLobbyBtn--secondary"
            disabled={suggesting || busy}
            onClick={() => void handleSuggest()}
          >
            {suggesting ? 'Generating…' : 'Random code'}
          </button>
          <button
            type="button"
            className="dashboard__hostsLobbyBtn dashboard__hostsLobbyBtn--primary"
            disabled={!canEnter}
            onClick={() => void handleEnter()}
          >
            {busy ? 'Joining…' : 'Join room'}
          </button>
        </div>
      </div>

      {err ? (
        <p className="dashboard__hostsLobbyErr" role="alert">
          {err}
        </p>
      ) : null}

      <p className="dashboard__hostsLobbyHint">
        After joining, the UI matches booked rooms: wish pool, case opening, voting, etc. Make sure your signed-in account has an email on file.
      </p>
    </section>
  )
}
