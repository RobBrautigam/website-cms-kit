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

/** One AI call for this admin (all three AI routes share the budget). */
export function consumeAiCall(userId: string): Promise<boolean> {
  return consumeRateLimit('ai', userId, RATE_LIMITS.ai.max, RATE_LIMITS.ai.windowSeconds)
}
