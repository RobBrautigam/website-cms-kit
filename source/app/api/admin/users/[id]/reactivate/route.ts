import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireSuperAdmin } from '@/lib/auth/require'
import { recordAdminAction } from '@/lib/auth/audit'

/**
 * POST /api/admin/users/[id]/reactivate
 *
 * Super-admin only. Inverse of /deactivate — lifts the auth.users ban
 * and clears user_roles.deactivated_at.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireSuperAdmin()

  const { id: targetUserId } = await params
  const svc = createServiceClient()

  // Snapshot the email before mutating so the audit payload records who was
  // reactivated even if the auth row is later edited.
  const { data: targetUser } = await svc.auth.admin.getUserById(targetUserId)
  const targetEmail = targetUser?.user?.email ?? null

  const { error: unbanError } = await svc.auth.admin.updateUserById(targetUserId, {
    ban_duration: 'none',
  })
  if (unbanError) {
    return NextResponse.json({ error: unbanError.message }, { status: 500 })
  }

  const { error: clearError } = await svc
    .from('user_roles')
    .update({ deactivated_at: null })
    .eq('user_id', targetUserId)

  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 })
  }

  await recordAdminAction({
    action: 'user.reactivate',
    resource_type: 'user',
    resource_id: targetUserId,
    payload: { email: targetEmail },
  })

  return NextResponse.json({ success: true })
}
