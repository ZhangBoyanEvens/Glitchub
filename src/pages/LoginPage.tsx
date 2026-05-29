import { SignIn, SignedIn, SignedOut } from '@clerk/clerk-react'
import { Navigate } from 'react-router-dom'
import { clerkAuthAppearance } from '../clerkAuthAppearance'
import { AuthShell } from './AuthShell'

export default function LoginPage() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

  return (
    <AuthShell>
      {!publishableKey ? (
        <p className="auth-shell__missing">
          Add <code>VITE_CLERK_PUBLISHABLE_KEY</code> to the project root{' '}
          <code>.env</code>, then restart <code>npm run dev</code>.
        </p>
      ) : (
        <>
          <SignedOut>
            <SignIn
              path="/"
              routing="path"
              signUpUrl="/sign-up"
              fallbackRedirectUrl="/dashboard/home"
              appearance={clerkAuthAppearance}
            />
          </SignedOut>
          <SignedIn>
            <Navigate to="/dashboard/home" replace />
          </SignedIn>
        </>
      )}
    </AuthShell>
  )
}
