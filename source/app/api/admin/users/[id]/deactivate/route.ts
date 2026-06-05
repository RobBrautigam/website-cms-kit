import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireSuperAdmin } from '@/lib/auth/require'
import { isLastActiveSuperAdmin } from '@/lib/auth/team-queries'
import { recordAdminAction } from '@/lib/auth/audit'

// 100 years in hours — Supabase's ban_duration accepts a Go-style duration
// string. Effectively permanent for any human admin lifetime, and trivially
// reversible via /reactivate.
const BAN_DURATION = '876000h'

/**
 * POST /api/admin/users/[id]/deactivate
 *
 * Super-admin only. Soft-deactivates the target user:
 *   - Bans the auth.users row (revokes any active session immediately)
 *   - Sets user_roles.deactivated_at = now()
 *
 * Refuses to deactivate the only active super_admin.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireSuperAdmin()

  const { id: targetUserId } = await params

  if (await isLastActiveSuperAdmin(targetUserId)) {
    return NextResponse.json(
      {
        error:
          'Cannot deactivate the only active super-admin. Promote someone else first.',
      },
      { status: 400 },
    )
  }

  const svc = createServiceClient()

  // Snapshot the email before mutating so the audit payload is complete even
  // if the user record is later renamed.
  const { data: targetUser } = await svc.auth.admin.getUserById(targetUserId)
  const targetEmail = targetUser?.user?.email ?? null

  const { error: banError } = await svc.auth.admin.updateUserById(targetUserId, {
    ban_duration: BAN_DURATION,
  })
  if (banError) {
    return NextResponse.json({ error: banError.message }, { status: 500 })
  }

  const { error: markError } = await svc
    .from('user_roles')
    .update({ deactivated_at: new Date().toISOString() })
    .eq('user_id', targetUserId)

  if (markError) {
    // Best-effort rollback: lift the ban so we don't leave a half-state.
    try {
      await svc.auth.admin.updateUserById(targetUserId, { ban_duration: 'none' })
    } catch { /* ignore */ }
    return NextResponse.json({ error: markError.message }, { status: 500 })
  }

  await recordAdminAction({
    action: 'user.deactivate',
    resource_type: 'user',
    resource_id: targetUserId,
    payload: { email: targetEmail },
  })

  return NextResponse.json({ success: true })
}
