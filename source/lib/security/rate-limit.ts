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
  /** The redirect counter: per visitor per redirect, and per redirect in total. */
  redirectHit: { perCaller: 5, perRedirect: 2000, windowSeconds: 60 * 60 },
} as const

/**
 * The visitor's address, as the hosting proxy reports it: the first
 * X-Forwarded-For entry, else X-Real-IP. Only as trustworthy as the proxy in
 * front of the app (Railway, Fly, Render and Vercel all set it); it keys a
 * counter, never an access decision.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0].trim()
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
 * resolves true while the caller is under the limit. Null means go ahead.
 * A limiter that cannot be reached refuses (503) rather than letting paid
 * calls through unmetered.
 */
export async function aiLimitRefusal(consume: () => Promise<boolean>): Promise<Response | null> {
  let allowed: boolean
  try {
    allowed = await consume()
  } catch {
    return Response.json(
      { error: 'The rate limiter is unavailable, so AI calls are paused. Check that migration 002 has run.' },
      { status: 503 }
    )
  }
  return allowed ? null : tooManyRequests(RATE_LIMITS.ai.windowSeconds)
}
