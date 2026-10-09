import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { RATE_LIMITS } from './rate-limit'

/**
 * The database half of the rate limits (migration 002, section 15). Both
 * functions run on the service role: the limiter's table and functions are
 * closed to the public and authenticated keys, so a caller cannot reset or
 * spend someone else's budget.
 */

/** True while `caller` is under `max` calls in the window. Throws if the call fails. */
export async function consumeRateLimit(bucket: string, caller: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await createServiceClient().rpc('consume_rate_limit', {
    bucket_name: bucket,
    caller_key: caller,
    max_hits: max,
    window_seconds: windowSeconds,
  })
  if (error) throw new Error(error.message)
  return data === true
}

/**
 * One AI call for this admin (all three AI routes share the budget): the
 * ten-minute limit, then the daily cap. True means go ahead; false means the
 * ten-minute limit is spent; a number is the daily cap's retry-after, in
 * seconds. The daily window is not spent when the ten-minute one refuses.
 */
export async function consumeAiCall(userId: string): Promise<boolean | number> {
  const { ai, aiDaily } = RATE_LIMITS
  if (!(await consumeRateLimit('ai', userId, ai.max, ai.windowSeconds))) return false
  if (!(await consumeRateLimit('ai_daily', userId, aiDaily.max, aiDaily.windowSeconds))) return aiDaily.windowSeconds
  return true
}
