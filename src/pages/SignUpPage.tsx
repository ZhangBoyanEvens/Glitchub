import { SignUp } from '@clerk/clerk-react'
import { clerkAuthAppearance } from '../clerkAuthAppearance'
import { AuthShell } from './AuthShell'

export default function SignUpPage() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

  return (
    <AuthShell>
      {!publishableKey ? (
        <p className="auth-shell__missing">
          Add <code>VITE_CLERK_PUBLISHABLE_KEY</code> to <code>.env</code> and
          restart the dev server.
        </p>
      ) : (
        <SignUp
          path="/sign-up"
          routing="path"
          signInUrl="/"
          fallbackRedirectUrl="/dashboard/home"
          appearance={clerkAuthAppearance}
        />
      )}
    </AuthShell>
  )
}
