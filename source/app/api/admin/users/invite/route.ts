import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireSuperAdmin } from '@/lib/auth/require'
import { recordAdminAction } from '@/lib/auth/audit'

/**
 * POST /api/admin/users/invite
 *
 * Super-admin only. Sends a Supabase magic-link invite that lands the
 * recipient on /admin/reset-password?context=invite where they pick their
 * own initial password. No plaintext password ever travels through email.
 *
 * On success, seeds a user_roles row (role from request body). The user's
 * display name is stored in auth.users.user_metadata.name (set via the
 * inviteUserByEmail `data` option).
 *
 * If the user_roles insert fails, the just-created auth.users row is rolled
 * back so the system stays consistent. The pattern matches what Linear /
 * Stripe / Vercel do for team invites.
 */

const InviteBody = z.object({
  email: z.string().email().toLowerCase().trim(),
  name: z.string().min(1).max(120).trim(),
  role: z.enum(['super_admin', 'admin']).default('admin'),
})

function siteOrigin(request: NextRequest): string {
  // Prefer the Forwarded host header (set by reverse proxies), then
  // X-Forwarded-Host, then the URL host. Falls back to the request URL.
  const forwardedHost = request.headers.get('x-forwarded-host')
  const protoHeader = request.headers.get('x-forwarded-proto')
  if (forwardedHost) {
    const proto = protoHeader || 'https'
    return `${proto}://${forwardedHost}`
  }
  return new URL(request.url).origin
}

export async function POST(request: NextRequest) {
  await requireSuperAdmin() // throws redirect if caller isn't a super_admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = InviteBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid invite request.',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    )
  }

  const { email, name, role } = parsed.data
  const serviceClient = createServiceClient()
  const origin = siteOrigin(request)
  const redirectTo = `${origin}/admin/reset-password?context=invite`

  const { data: invited, error: inviteError } =
    await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { name },
    })

  if (inviteError || !invited?.user) {
    const message = inviteError?.message || 'Failed to send invite.'
    const status =
      message.toLowerCase().includes('already') ||
      message.toLowerCase().includes('registered')
        ? 409
        : 500
    return NextResponse.json({ error: message }, { status })
  }

  const newUserId = invited.user.id

  // Best-effort transactional behavior: if either insert fails, roll back
  // the auth.users row so the system doesn't stay half-provisioned.
  const { error: roleError } = await serviceClient
    .from('user_roles')
    .insert({ user_id: newUserId, role })

  if (roleError) {
    try {
      await serviceClient.auth.admin.deleteUser(newUserId)
    } catch { /* best-effort rollback */ }
    return NextResponse.json(
      { error: `Role assignment failed: ${roleError.message}` },
      { status: 500 },
    )
  }

  await recordAdminAction({
    action: 'user.invite',
    resource_type: 'user',
    resource_id: newUserId,
    payload: { email, role },
  })

  return NextResponse.json({
    success: true,
    userId: newUserId,
    email,
    role,
    name,
  })
}
