// Stand-in for `@/lib/auth/audit`.
import { calls } from './stubs.mjs'

export async function recordAdminAction(input) {
  calls.audit.push(input.action)
}
