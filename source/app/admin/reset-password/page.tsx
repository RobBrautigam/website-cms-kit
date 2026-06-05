import type { Metadata } from 'next'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import ResetPasswordForm from './ResetPasswordForm'
import AuthShell from '@/components/admin/AuthShell'

export const metadata: Metadata = {
  title: 'Set Password | Acme',
  robots: 'noindex, nofollow',
}

type Search = {
  context?: 'invite' | 'recovery' | string
  code?: string
  error?: string
  error_description?: string
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const params = await searchParams
  const rawContext = params?.context
  const context: 'invite' | 'recovery' =
    rawContext === 'invite' ? 'invite' : 'recovery'

  // Supabase magic-link can land here in two flow shapes:
  //   1. PKCE: ?code=<pkce-code>   — exchange server-side, sets cookies
  //   2. Implicit: #access_token=... in the URL hash — handled CLIENT-SIDE
  //      because hashes never reach the server. ResetPasswordForm parses it.
  //   3. Error: ?error=...&error_description=... — link expired or invalid
  let exchangeError: string | null = null

  if (params?.error) {
    exchangeError = params.error_description || params.error
  } else if (params?.code) {
    try {
      const supabase = await createServerSupabaseClient()
      const { error } = await supabase.auth.exchangeCodeForSession(params.code)
      if (error) exchangeError = error.message
    } catch (e) {
      exchangeError = e instanceof Error ? e.message : 'Could not validate link.'
    }
  }

  const heading = context === 'invite' ? 'Welcome to Acme' : 'Set a new password'
  const subhead =
    context === 'invite'
      ? 'Choose a password to finish setting up your account.'
      : 'Pick a new password to sign back in.'

  return (
    <AuthShell heading={heading} subhead={subhead}>
      <ResetPasswordForm context={context} exchangeError={exchangeError} />
    </AuthShell>
  )
}
