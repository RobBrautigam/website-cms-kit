// Stand-in for `@/lib/auth/mfa`.
import { calls } from './stubs.mjs'

export async function regenerateRecoveryCodes() {
  calls.regenerate++
  return ['aaaa-bbbb', 'cccc-dddd']
}
export async function deleteAllRecoveryCodes() {}
