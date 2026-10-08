// Stand-in for `@/lib/auth/reauth`: one known-good password.
import { calls } from './stubs.mjs'

export const RIGHT_PASSWORD = 'correct horse battery staple'

export async function passwordMatches(email, password) {
  calls.passwords.push(password)
  return password === RIGHT_PASSWORD
}
