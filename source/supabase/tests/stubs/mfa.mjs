// Stand-in for `@/lib/auth/mfa`.
import { calls, fakes } from './stubs.mjs'

export async function regenerateRecoveryCodes() {
  calls.regenerate++
  return ['aaaa-bbbb', 'cccc-dddd']
}
export async function deleteAllRecoveryCodes() {}
export async function findUnusedRecoveryCodeId() {
  calls.recoveryLookups++
  return fakes.recoveryCode
}
export async function consumeRecoveryCodeById() {
  return true
}
export async function releaseRecoveryCodeById() {}
export async function unenrollAllFactors() {
  return { ok: true, deleted: 1 }
}
