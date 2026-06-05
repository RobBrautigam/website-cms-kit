/**
 * Admin role taxonomy. The `editor` value is reserved in the DB CHECK
 * constraint as a deprecated/future-third-tier slot but is not granted any
 * capability today and is not surfaced in the UI. See
 * docs/03-authorization-and-rls.md for the role model.
 */
export type AdminRole = 'super_admin' | 'admin'

export interface UserRoleRow {
  user_id: string
  role: AdminRole | 'editor'
  deactivated_at: string | null
  created_at: string
}

export const ADMIN_ROLES: readonly AdminRole[] = ['super_admin', 'admin'] as const

export function isAdminRole(value: unknown): value is AdminRole {
  return value === 'super_admin' || value === 'admin'
}
