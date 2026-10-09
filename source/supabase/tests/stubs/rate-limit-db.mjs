// Stand-in for `@/lib/security/rate-limit-db`.
import { calls, fakes } from './stubs.mjs'

export async function consumeAiCall() {
  calls.limits.push('ai')
  if (fakes.aiAllowed instanceof Error) throw fakes.aiAllowed
  return fakes.aiAllowed
}
export async function consumeRateLimit(bucket) {
  calls.limits.push(bucket)
  const answer = fakes.limits[bucket]
  if (answer instanceof Error) throw answer
  return answer ?? true
}
