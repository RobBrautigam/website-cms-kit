import { createServiceClient } from '@/lib/supabase/server'
import type { AdminRole } from './types'

export interface TeamMember {
  id: string
  email: string
  name: string
  role: AdminRole | 'editor'
  createdAt: string
  lastSignInAt: string | null
  deactivatedAt: string | null
}

/**
 * Server-only. Lists every user_roles row joined with auth.users.
 * Service-client so RLS doesn't apply. Display name is read from
 * auth.users.user_metadata.name (set during invite).
 *
 * Sort order: super_admins first (by created_at), then admins
 * (by created_at), then deactivated rows last regardless of role.
 */
export async function fetchTeamMembers(): Promise<TeamMember[]> {
  const svc = createServiceClient()

  const [rolesResult, authResult] = await Promise.all([
    svc.from('user_roles').select('user_id, role, deactivated_at, created_at'),
    svc.auth.admin.listUsers(),
  ])

  type RoleRow = { user_id: string; role: string; deactivated_at: string | null; created_at: string }
  const roles = (rolesResult.data ?? []) as RoleRow[]
  const authUsers = authResult.data?.users ?? []

  // Build a single map keyed on user id containing email, name (from
  // user_metadata), and last sign-in. Name falls back to the email local part
  // for legacy accounts created outside the invite flow (e.g., an account
  // created directly via the Supabase dashboard has no user_metadata).
  const userMap = new Map<string, { email: string; name: string; lastSignInAt: string | null }>()
  for (const u of authUsers) {
    const meta = (u.user_metadata ?? {}) as { name?: string }
    userMap.set(u.id, {
      email: u.email ?? '',
      name: meta.name ?? u.email?.split('@')[0] ?? '',
      lastSignInAt: u.last_sign_in_at ?? null,
    })
  }

  const members: TeamMember[] = roles.map((r) => {
    const u = userMap.get(r.user_id)
    return {
      id: r.user_id,
      email: u?.email ?? '',
      name: u?.name ?? '',
      role: r.role as TeamMember['role'],
      createdAt: r.created_at,
      lastSignInAt: u?.lastSignInAt ?? null,
      deactivatedAt: r.deactivated_at,
    }
  })

  members.sort((a, b) => {
    // Deactivated rows last
    const aDeactivated = a.deactivatedAt !== null
    const bDeactivated = b.deactivatedAt !== null
    if (aDeactivated !== bDeactivated) return aDeactivated ? 1 : -1

    // Super admins before admins
    const rank = (role: TeamMember['role']) =>
      role === 'super_admin' ? 0 : role === 'admin' ? 1 : 2
    const ar = rank(a.role)
    const br = rank(b.role)
    if (ar !== br) return ar - br

    // Then by created_at ascending
    return a.createdAt.localeCompare(b.createdAt)
  })

  return members
}

/**
 * Returns true iff the given user is the only currently-active super_admin.
 * Used to guard role-demotion and deactivation so the system never ends up
 * with zero super-admins. Mirrors GitHub's "cannot remove last owner" rule.
 */
export async function isLastActiveSuperAdmin(userId: string): Promise<boolean> {
  const svc = createServiceClient()
  const { data, error } = await svc
    .from('user_roles')
    .select('user_id, role, deactivated_at')
    .eq('role', 'super_admin')
    .is('deactivated_at', null)

  if (error || !data) return false
  if (data.length !== 1) return false
  return data[0].user_id === userId
}
