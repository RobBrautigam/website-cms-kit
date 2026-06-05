import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireSuperAdmin } from '@/lib/auth/require'
import { recordAdminAction } from '@/lib/auth/audit'

function siteOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const protoHeader = request.headers.get('x-forwarded-proto')
  if (forwardedHost) {
    const proto = protoHeader || 'https'
    return `${proto}://${forwardedHost}`
  }
  return new URL(request.url).origin
}

/**
 * POST /api/admin/users/[id]/recover
 *
 * Super-admin only. Triggers a Supabase password recovery email for the
 * target user — useful when an admin forgets their password and needs a
 * super-admin to nudge them. Same magic-link flow as /admin/forgot-password.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireSuperAdmin()

  const { id: targetUserId } = await params
  const svc = createServiceClient()

  // Look up the email so we can call resetPasswordForEmail. Supabase doesn't
  // expose an "admin trigger recovery for this user_id" call directly.
  const { data: userData, error: lookupError } =
    await svc.auth.admin.getUserById(targetUserId)

  if (lookupError || !userData?.user?.email) {
    return NextResponse.json(
      { error: lookupError?.message || 'User not found.' },
      { status: 404 },
    )
  }

  const origin = siteOrigin(request)

  // IMPORTANT: use resetPasswordForEmail (NOT auth.admin.generateLink).
  // generateLink only generates the link — it doesn't trigger the email send.
  // resetPasswordForEmail goes through Supabase's mailer and uses the
  // configured Recovery email template. The service-role client is allowed
  // to call it; it routes through the same /auth/v1/recover endpoint as the
  // anon client.
  const { error: recoverError } = await svc.auth.resetPasswordForEmail(
    userData.user.email,
    { redirectTo: `${origin}/admin/reset-password?context=recovery` },
  )

  if (recoverError) {
    const message = recoverError.message || ''
    const code = (recoverError as { code?: string }).code

    // Surface rate-limit explicitly so the Team UI can show a useful toast
    // ("Too many requests, please wait a minute") instead of a generic 500.
    if (
      code === 'over_email_send_rate_limit' ||
      message.toLowerCase().includes('rate limit')
    ) {
      return NextResponse.json(
        {
          error:
            'Email rate limit reached. Wait about a minute before sending another recovery to this address.',
          code: 'rate_limited',
        },
        { status: 429 },
      )
    }

    return NextResponse.json({ error: message || 'Could not send recovery email.' }, { status: 500 })
  }

  await recordAdminAction({
    action: 'user.recover_password',
    resource_type: 'user',
    resource_id: targetUserId,
    payload: {
      email: userData.user.email,
      recovery_method: 'magic_link',
    },
  })

  return NextResponse.json({ success: true, email: userData.user.email })
}
