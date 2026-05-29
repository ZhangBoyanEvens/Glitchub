import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

export function AppointmentInviteLanding() {
  const { inviteRef } = useParams()
  const [search] = useSearchParams()

  const token = search.get('token')?.trim() ?? ''
  const declineToken = search.get('declineToken')?.trim() ?? ''

  const validationError = useMemo(() => {
    if (!inviteRef) return 'Invalid invite link.'
    if (!token && !declineToken) {
      return 'Missing invite token. Please use the buttons in your email.'
    }
    return null
  }, [inviteRef, token, declineToken])

  const [state, setState] = useState<'loading' | 'done' | 'err'>(() =>
    validationError ? 'err' : 'loading',
  )
  const [msg, setMsg] = useState(() => validationError ?? '')
  const [roomId, setRoomId] = useState<string | null>(null)

  useEffect(() => {
    if (validationError) return
    let cancelled = false
    ;(async () => {
      try {
        const body = token ? { acceptToken: token } : { declineToken }
        const res = await fetch('/api/appointment-invite/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = (await res.json().catch(() => ({}))) as {
          message?: string
          action?: string
          roomId?: string
          alreadyAccepted?: boolean
          alreadyDeclined?: boolean
        }
        if (cancelled) return
        if (!res.ok) {
          setState('err')
          setMsg(data.message ?? `Request failed (${res.status})`)
          return
        }
        setState('done')
        if (data.action === 'accepted') {
          setRoomId(data.roomId ?? null)
          setMsg(
            data.alreadyAccepted
              ? 'You already accepted this invite.'
              : 'You have accepted the invite.',
          )
        } else {
          setMsg(
            data.alreadyDeclined
              ? 'You already declined this invite.'
              : 'You have declined the invite.',
          )
        }
      } catch (e) {
        if (!cancelled) {
          setState('err')
          setMsg(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [validationError, token, declineToken])

  if (validationError) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0a0612',
          color: '#e9e4ff',
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem',
          boxSizing: 'border-box',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', marginTop: 0 }}>Glitchub invite</h1>
        <p role="alert" style={{ color: '#fca5a5' }}>
          {validationError}
        </p>
        <p style={{ marginTop: '2rem' }}>
          <Link to="/" style={{ color: '#94a3b8' }}>
            Home
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0612',
        color: '#e9e4ff',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem',
        boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: '1.25rem', marginTop: 0 }}>Glitchub invite</h1>
      {inviteRef ? (
        <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Ref: {inviteRef}</p>
      ) : null}
      {state === 'loading' ? <p>Working…</p> : null}
      {state === 'err' ? (
        <p role="alert" style={{ color: '#fca5a5' }}>
          {msg}
        </p>
      ) : null}
      {state === 'done' ? (
        <>
          <p>{msg}</p>
          {roomId ? (
            <p>
              <strong>room_id</strong> (save for joining the room later):{' '}
              <code
                style={{
                  fontSize: '1.05rem',
                  wordBreak: 'break-all',
                  color: '#fef3c7',
                }}
              >
                {roomId}
              </code>
            </p>
          ) : null}
        </>
      ) : null}
      <p style={{ marginTop: '2rem' }}>
        <Link to="/dashboard/hosts/book" style={{ color: '#c4b5fd' }}>
          Open booking dashboard
        </Link>
        {' · '}
        <Link to="/" style={{ color: '#94a3b8' }}>
          Home
        </Link>
      </p>
    </div>
  )
}
