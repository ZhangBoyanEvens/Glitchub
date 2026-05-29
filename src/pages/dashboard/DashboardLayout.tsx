import { SignedIn, SignedOut, UserButton } from '@clerk/clerk-react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { GlitchubLogo } from '../../components/GlitchubLogo'
import './dashboard.css'

function HostsNavLink() {
  const { pathname } = useLocation()
  const active =
    pathname === '/dashboard/hosts' || pathname.startsWith('/dashboard/hosts/')
  return (
    <Link
      to="/dashboard/hosts"
      className={`dashboard__link${active ? ' is-active' : ''}`}
    >
      Hosts
    </Link>
  )
}

function DashboardMainInner() {
  const { pathname } = useLocation()
  const fillHeight =
    pathname.startsWith('/dashboard/organization') ||
    pathname.startsWith('/dashboard/hosts/room/')
  return (
    <div
      className={
        fillHeight
          ? 'dashboard__mainInner dashboard__mainInner--fill'
          : 'dashboard__mainInner'
      }
    >
      <Outlet />
    </div>
  )
}

function DashboardShell() {
  return (
    <div className="dashboard">
      <header className="dashboard__nav">
        <div className="dashboard__navInner">
          <Link to="/dashboard/home" className="dashboard__brand">
            <GlitchubLogo className="dashboard__brandMark" size={30} />
            <span>Glitchub</span>
          </Link>
          <nav className="dashboard__links" aria-label="Dashboard">
            <NavLink
              to="/dashboard/home"
              className={({ isActive }) =>
                `dashboard__link${isActive ? ' is-active' : ''}`
              }
            >
              Homepage
            </NavLink>
            <NavLink
              to="/dashboard/organization"
              className={({ isActive }) =>
                `dashboard__link${isActive ? ' is-active' : ''}`
              }
            >
              Organization
            </NavLink>
            <NavLink
              to="/dashboard/games"
              className={({ isActive }) =>
                `dashboard__link${isActive ? ' is-active' : ''}`
              }
            >
              Games
            </NavLink>
            <HostsNavLink />
          </nav>
          <div className="dashboard__user">
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </header>
      <main className="dashboard__main">
        <DashboardMainInner />
      </main>
    </div>
  )
}

export function DashboardLayout() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

  if (!publishableKey) {
    return (
      <div className="dashboard">
        <main className="dashboard__main">
          <div className="dashboard__mainInner">
            <p className="dashboard__missing">
              Add <code>VITE_CLERK_PUBLISHABLE_KEY</code> to the project root{' '}
              <code>.env</code>, then restart the dev server.
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <>
      <SignedIn>
        <DashboardShell />
      </SignedIn>
      <SignedOut>
        <Navigate to="/" replace />
      </SignedOut>
    </>
  )
}
