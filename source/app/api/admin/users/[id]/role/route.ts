import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireSuperAdmin } from '@/lib/auth/require'
import { isLastActiveSuperAdmin } from '@/lib/auth/team-queries'
import { recordAdminAction } from '@/lib/auth/audit'

const Body = z.object({ role: z.enum(['super_admin', 'admin']) })

/**
 * PATCH /api/admin/users/[id]/role
 *
 * Super-admin only. Changes another user's role. Refuses to demote the
 * only active super_admin (last-owner protection — GitHub pattern).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireSuperAdmin()

  const { id: targetUserId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = Body.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'role must be super_admin or admin.' },
      { status: 400 },
    )
  }

  const newRole = parsed.data.role

  // If we're DEMOTING a super_admin to admin, verify they aren't the last one.
  if (newRole === 'admin' && (await isLastActiveSuperAdmin(targetUserId))) {
    return NextResponse.json(
      {
        error:
          'Cannot demote the only active super-admin. Promote someone else first.',
      },
      { status: 400 },
    )
  }

  const svc = createServiceClient()

  // Read the user's current role BEFORE applying the change so the audit
  // payload can record both `from` and `to` values.
  const { data: existing, error: readError } = await svc
    .from('user_roles')
    .select('role')
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  const previousRole = existing.role as string

  const { error } = await svc
    .from('user_roles')
    .update({ role: newRole })
    .eq('user_id', targetUserId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await recordAdminAction({
    action: 'user.role_change',
    resource_type: 'user',
    resource_id: targetUserId,
    payload: { from: previousRole, to: newRole },
  })

  return NextResponse.json({ success: true, role: newRole })
}
