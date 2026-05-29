import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { GlitchubLogo } from '../components/GlitchubLogo'
import './auth-shell.css'

const DEFAULT_HERO_LINES = ['Never', 'Play', 'Genshin'] as const

type AuthShellProps = {
  children: ReactNode
  /** Hero lines on the left; one string per line */
  heroLines?: readonly string[]
}

export function AuthShell({
  children,
  heroLines = DEFAULT_HERO_LINES,
}: AuthShellProps) {
  const { pathname } = useLocation()
  const onSignUp = pathname.startsWith('/sign-up')

  return (
    <div className="auth-shell">
      <div className="auth-shell__bloom auth-shell__bloom--a" aria-hidden />
      <div className="auth-shell__bloom auth-shell__bloom--b" aria-hidden />
      <div className="auth-shell__bloom auth-shell__bloom--c" aria-hidden />
      <div className="auth-shell__mesh" aria-hidden />
      <div className="auth-shell__scan" aria-hidden />

      <header className="auth-shell__header">
        <Link className="auth-shell__brand" to="/">
          <GlitchubLogo className="auth-shell__brandMark" size={32} />
          <span>Glitchub</span>
        </Link>
        {onSignUp ? (
          <Link className="auth-shell__skip" to="/">
            Back to sign in
          </Link>
        ) : null}
      </header>

      <main className="auth-shell__main">
        <div className="auth-shell__layout">
          <div className="auth-shell__aside">
            <div className="auth-shell__hero">
              {heroLines.map((line, i) => (
                <span key={`${line}-${i}`} className="auth-shell__heroLine">
                  {line}
                </span>
              ))}
            </div>
          </div>
          <div className="auth-shell__rail">
            <div className="auth-shell__card">
              <div className="auth-shell__cardInner">
                <div className="auth-shell__clerk">{children}</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
