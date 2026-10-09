// Stand-in for `@/lib/security/rate-limit-db`.
import { fakes } from './stubs.mjs'

export async function consumeAiCall() {
  if (fakes.aiAllowed instanceof Error) throw fakes.aiAllowed
  return fakes.aiAllowed
}
export async function consumeRateLimit() {
  return true
}
