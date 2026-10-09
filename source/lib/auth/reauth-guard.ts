import 'server-only'
import { passwordMatches } from '@/lib/auth/reauth'
import { recordAdminAction } from '@/lib/auth/audit'
import { RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'
import { consumeRateLimit } from '@/lib/security/rate-limit-db'

/**
 * The password re-check in front of a sensitive two-step change (new recovery
 * codes, turning two-step off), limited per admin and on the record.
 *
 * A stolen session cannot guess the password at leisure: each admin gets
 * RATE_LIMITS.reauth attempts per window, counted before the password is
 * tried, and every wrong password and every limited attempt writes an audit
 * row. The caller is a signed-in admin, so a stranger cannot write these
 * rows (failed sign-ins themselves are in Supabase's own auth log).
 *
 * Null means the password matched; otherwise the response to send.
 */
export async function reauthRefusal(
  user: { id: string; email?: string | null },
  password: string,
  context: string
): Promise<Response | null> {
  const { max, windowSeconds } = RATE_LIMITS.reauth
  let allowed: boolean
  try {
    allowed = await consumeRateLimit('reauth', user.id, max, windowSeconds)
  } catch {
    return Response.json(
      { error: 'The rate limiter is unavailable, so password checks are paused. Check that migration 002 has run.' },
      { status: 503 }
    )
  }
  if (!allowed) {
    await recordAdminAction({ action: 'auth.reauth_limited', payload: { context } })
    return tooManyRequests(windowSeconds)
  }
  if (!user.email || !(await passwordMatches(user.email, password, context))) {
    await recordAdminAction({ action: 'auth.reauth_failed', payload: { context } })
    return Response.json({ error: 'Wrong password' }, { status: 401 })
  }
  return null
}

/**
 * Spend one recovery-code attempt for this admin. Null means go ahead; a
 * limited attempt is audited and refused before the code is looked up.
 */
export async function recoveryCodeRefusal(userId: string): Promise<Response | null> {
  const { max, windowSeconds } = RATE_LIMITS.recoveryCode
  let allowed: boolean
  try {
    allowed = await consumeRateLimit('recovery_code', userId, max, windowSeconds)
  } catch {
    return Response.json(
      { error: 'The rate limiter is unavailable, so recovery codes are paused. Check that migration 002 has run.' },
      { status: 503 }
    )
  }
  if (allowed) return null
  await recordAdminAction({ action: 'auth.mfa.recovery_limited' })
  return tooManyRequests(windowSeconds)
}
