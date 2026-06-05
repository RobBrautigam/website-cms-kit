import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { ADMIN_ROLES, isAdminRole, type AdminRole } from './types'
import { mustEnforceMFA } from './mfa'

export interface RequireResult {
  user: User
  role: AdminRole
}

/**
 * Internal: resolve the user + admin role for the current request, redirecting
 * unauthenticated / non-admin / deactivated users to the login page. Does NOT
 * enforce MFA — used as the shared base for both requireAdmin (MFA-gated) and
 * requirePartialAdmin (MFA-flow pages that must be reachable pre-AAL2).
 */
async function resolveAdmin(): Promise<RequireResult> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  // Service client to read user_roles regardless of self-RLS shape.
  const svc = createServiceClient()
  const { data } = await svc
    .from('user_roles')
    .select('role, deactivated_at')
    .eq('user_id', user.id)
    .single()

  if (!data || data.deactivated_at !== null || !isAdminRole(data.role)) {
    await supabase.auth.signOut()
    redirect('/admin/login?error=unauthorized')
  }

  return { user, role: data.role }
}

/**
 * Server-side auth gate for any /admin/* route or /api/admin/* endpoint that
 * requires a fully-authenticated admin session.
 *
 * - Redirects unauthenticated users to /admin/login.
 * - Signs out and redirects users with no role row, deactivated rows, or
 *   non-admin roles. Defense in depth: even if a user slipped through the
 *   proxy, they cannot render an admin page.
 * - Enforces MFA server-side:
 *    - If the user has any verified TOTP factor (nextLevel === 'aal2') but the
 *      current session is still aal1, redirect to /admin/login/verify so the
 *      user must complete the TOTP challenge before they can act.
 *    - If the user has NO verified factor and is past the grace window
 *      (mustEnforceMFA), redirect to /admin/security/enroll.
 *
 * Routes that participate in the MFA flow itself (login/verify, security/enroll,
 * the /api/admin/mfa/* endpoints they call) MUST use requirePartialAdmin
 * instead, otherwise the AAL gate creates an infinite redirect loop.
 *
 * Returns the authenticated user and their resolved admin role.
 */
export async function requireAdmin(): Promise<RequireResult> {
  const result = await resolveAdmin()
  const supabase = await createServerSupabaseClient()

  // AAL gate: if the user has a verified factor, the session must be aal2.
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
    redirect('/admin/login/verify')
  }

  // Enrollment gate: no verified factor + past grace window -> force enrollment.
  // Skip the listFactors call when the AAL data already implies a factor exists
  // (nextLevel === 'aal2' was handled above).
  const { data: factorsData } = await supabase.auth.mfa.listFactors()
  const verifiedTotp = (factorsData?.totp ?? []).some((f) => f.status === 'verified')
  if (!verifiedTotp && mustEnforceMFA(result.user.created_at ?? null)) {
    redirect('/admin/security/enroll')
  }

  return result
}

/**
 * Auth gate for the MFA-flow pages and endpoints themselves: login/verify,
 * security/enroll, and the /api/admin/mfa/* endpoints those pages call. Does
 * user + role checks but DOES NOT enforce the AAL gate or the enrollment gate.
 *
 * This separation exists so the MFA pages can authenticate the user without
 * infinite-redirecting through their own gate. The user is still required to
 * complete the flow before they can reach any other admin surface — that's
 * enforced by requireAdmin everywhere else.
 *
 * Use this ONLY for routes that are part of the MFA challenge / enrollment
 * flow. Sensitive 2FA management actions (disable, regenerate codes) must
 * still use requireAdmin so they require AAL2.
 */
export async function requirePartialAdmin(): Promise<RequireResult> {
  return resolveAdmin()
}

/**
 * Stricter gate for super-admin-only surfaces (team management, role
 * changes, deactivation). Composes requireAdmin and adds the super_admin
 * check, so this surface inherits the full MFA gate.
 */
export async function requireSuperAdmin(): Promise<RequireResult> {
  const result = await requireAdmin()
  if (result.role !== 'super_admin') {
    redirect('/admin/posts?error=super_admin_required')
  }
  return result
}

/**
 * Read-only variant: returns the role for the current request without
 * redirecting. Use sparingly — UI code should rely on the role passed down
 * from the layout, not call this in nested components.
 *
 * Returns null if no user, no row, deactivated, or non-admin role.
 */
export async function getAdminRoleOrNull(): Promise<AdminRole | null> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createServiceClient()
  const { data } = await svc
    .from('user_roles')
    .select('role, deactivated_at')
    .eq('user_id', user.id)
    .single()

  if (!data || data.deactivated_at !== null || !isAdminRole(data.role)) return null
  return data.role
}

export { ADMIN_ROLES }
export type { AdminRole }
