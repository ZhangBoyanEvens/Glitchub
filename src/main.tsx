import { ClerkProvider } from '@clerk/clerk-react'
import { createRoot } from 'react-dom/client'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom'
import { clerkAuthAppearance } from './clerkAuthAppearance'
import './index.css'
import { DashboardOrganization } from './pages/dashboard/DashboardOrganization.tsx'
import { DashboardGames } from './pages/dashboard/DashboardGames.tsx'
import { DashboardOrgGames } from './pages/dashboard/DashboardOrgGames.tsx'
import { DashboardHome } from './pages/dashboard/DashboardHome.tsx'
import { DashboardHostsBook } from './pages/dashboard/hosts/DashboardHostsBook.tsx'
import { DashboardHostsHome } from './pages/dashboard/hosts/DashboardHostsHome.tsx'
import { DashboardHostsJoin } from './pages/dashboard/hosts/DashboardHostsJoin.tsx'
import { DashboardHostsLayout } from './pages/dashboard/hosts/DashboardHostsLayout.tsx'
import { DashboardHostsRoom } from './pages/dashboard/hosts/DashboardHostsRoom.tsx'
import { DashboardHostsLobby } from './pages/dashboard/hosts/DashboardHostsLobby.tsx'
import { AppointmentInviteLanding } from './pages/AppointmentInviteLanding.tsx'
import { DashboardLayout } from './pages/dashboard/DashboardLayout.tsx'
import LoginPage from './pages/LoginPage.tsx'
import SignUpPage from './pages/SignUpPage.tsx'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function AppRoutes() {
  const navigate = useNavigate()

  const tree = (
    <Routes>
      <Route path="/book/:inviteRef" element={<AppointmentInviteLanding />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />
      <Route path="/dashboard" element={<DashboardLayout />}>
        <Route index element={<Navigate to="home" replace />} />
        <Route path="home" element={<DashboardHome />} />
        <Route path="organization" element={<DashboardOrganization />} />
        <Route path="games" element={<DashboardOrgGames />} />
        <Route path="catalog" element={<DashboardGames />} />
        <Route path="hosts" element={<DashboardHostsLayout />}>
          <Route index element={<DashboardHostsHome />} />
          <Route path="book" element={<DashboardHostsBook />} />
          <Route path="lobby" element={<DashboardHostsLobby />} />
          <Route path="join" element={<DashboardHostsJoin />} />
          <Route path="room/:roomId" element={<DashboardHostsRoom />} />
        </Route>
      </Route>
      {/* Clerk path 模式在根路径下会占用子 path，必须用 splat 接住 */}
      <Route path="*" element={<LoginPage />} />
    </Routes>
  )

  if (!publishableKey) {
    return tree
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={clerkAuthAppearance}
      routerPush={(to) => Promise.resolve(navigate(to))}
      routerReplace={(to) => Promise.resolve(navigate(to, { replace: true }))}
    >
      {tree}
    </ClerkProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <AppRoutes />
  </BrowserRouter>,
)
