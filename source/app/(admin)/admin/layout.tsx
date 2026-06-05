import { requireAdmin } from '@/lib/auth/require'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import AdminShell from '@/components/admin/AdminShell'
import { MFAEnrollmentBanner } from '@/components/admin/MFAEnrollmentBanner'

export const metadata = {
  robots: 'noindex, nofollow',
}

/**
 * Layout for the protected admin surface (everything in src/app/(admin)/).
 * Public auth pages (/admin/login, /admin/forgot-password, /admin/reset-password)
 * and the forced 2FA enrollment page (/admin/security/enroll) are intentionally
 * OUTSIDE this route group — they live under src/app/admin/ and inherit only
 * the root layout, so the AdminShell never wraps them regardless of who's
 * signed in.
 *
 * This layout uses requireAdmin() as the canonical gate. If the request gets
 * here without an active admin session, we redirect to the login page rather
 * than render an empty shell.
 *
 * The MFAEnrollmentBanner sits ABOVE AdminShell so the soft prompt appears
 * on every admin page during the grace window. After the grace window
 * elapses, the banner returns null and the login flow hard-redirects to
 * /admin/security/enroll instead.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, role } = await requireAdmin()

  // Fetch MFA factor state for the banner. If the call fails for any reason,
  // we silently treat the user as enrolled so the banner doesn't block their
  // workflow on a transient error — it's a soft prompt, not a security gate.
  let hasFactor = true
  try {
    const supabase = await createServerSupabaseClient()
    const { data } = await supabase.auth.mfa.listFactors()
    hasFactor = (data?.totp ?? []).some((f) => f.status === 'verified')
  } catch {
    // hasFactor stays true
  }

  return (
    <>
      <MFAEnrollmentBanner
        hasFactor={hasFactor}
        userCreatedAt={user.created_at ?? null}
      />
      <AdminShell userEmail={user.email || ''} userRole={role}>
        {children}
      </AdminShell>
    </>
  )
}
