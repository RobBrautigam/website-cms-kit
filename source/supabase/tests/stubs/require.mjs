// Stand-in for `@/lib/auth/require`: a signed-in, two-factor admin.
import { calls } from './stubs.mjs'

const user = { id: '00000000-0000-4000-8000-0000000000a1', email: 'admin@example.com' }

export async function requireAdmin() {
  calls.requireAdmin++
  return { user, role: 'admin' }
}
export const requireSuperAdmin = requireAdmin
export const requirePartialAdmin = requireAdmin
export async function getAdminRoleOrNull() {
  return 'admin'
}
export const ADMIN_ROLES = ['super_admin', 'admin']
