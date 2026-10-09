/**
 * Per-caller limits for the paid AI routes and the public redirect counter.
 *
 * The counting happens in Postgres (`consume_rate_limit()` and
 * `record_redirect_hit()` in migration 002), so a limit holds across every
 * server instance and survives a restart. These helpers are the pure half:
 * the numbers, who the caller is, and what a refusal looks like.
 * lib/security/rate-limit-db.ts makes the database call.
 */

export const RATE_LIMITS = {
  /** Each admin, across the three AI routes together. */
  ai: { max: 20, windowSeconds: 10 * 60 },
  /** Each admin, across the three AI routes, per day: the ceiling on a day's bill. */
  aiDaily: { max: 100, windowSeconds: 24 * 60 * 60 },
  /** Password re-checks (new recovery codes, turning two-step off), per admin. */
  reauth: { max: 5, windowSeconds: 15 * 60 },
  /** Recovery-code sign-ins, per admin. */
  recoveryCode: { max: 5, windowSeconds: 15 * 60 },
  /** The redirect counter: per visitor per redirect, and per redirect in total. */
  redirectHit: { perCaller: 5, perRedirect: 2000, windowSeconds: 60 * 60 },
} as const

/**
 * The visitor's address: the X-Forwarded-For entry the trusted proxy wrote,
 * else X-Real-IP. A proxy APPENDS the address it saw, so the entries on the
 * left are whatever the visitor sent and the trusted one is counted from the
 * right: the last entry behind one proxy (the default), the second from the
 * right behind two (TRUSTED_PROXY_HOPS=2, a CDN in front of the host). It
 * keys a counter, never an access decision.
 */
export function clientAddress(
  headers: Headers,
  trustedHops: number = Number(process.env.TRUSTED_PROXY_HOPS) || 1
): string {
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  const hops = Math.max(1, Math.floor(trustedHops))
  const forwarded = entries.length ? entries[Math.max(0, entries.length - hops)] : ''
  const real = headers.get('x-real-ip')?.trim()
  return (forwarded || real || 'unknown').slice(0, 64)
}

export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    { error: 'Too many requests. Wait a few minutes and try again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  )
}

/**
 * Spend one AI call for this admin. `consume` is the database call; it
 * resolves true while the caller is under the limits, false over the
 * ten-minute one, or the retry-after seconds over the daily cap. Null means
 * go ahead. A limiter that cannot be reached refuses (503) rather than
 * letting paid calls through unmetered.
 */
export async function aiLimitRefusal(consume: () => Promise<boolean | number>): Promise<Response | null> {
  let allowed: boolean | number
  try {
    allowed = await consume()
  } catch {
    return Response.json(
      { error: 'The rate limiter is unavailable, so AI calls are paused. Check that migration 002 has run.' },
      { status: 503 }
    )
  }
  if (allowed === true) return null
  return tooManyRequests(typeof allowed === 'number' ? allowed : RATE_LIMITS.ai.windowSeconds)
}
