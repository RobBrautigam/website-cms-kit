import 'server-only'
import { createAnonServerClient } from '@/lib/supabase/server'

/**
 * Re-check the signed-in admin's password before a step that changes how
 * they sign in (turning two-factor off, minting new recovery codes). A stolen
 * session cookie alone is then not enough to lock the real owner out or to
 * walk away with fresh codes.
 *
 * The check runs on a throwaway, cookie-less client: signing in on the
 * cookie client would swap this verified (AAL2) session for a fresh AAL1
 * one. The extra session it creates is ended at once (local scope only: a
 * global sign-out would end the user's real session too). A failed sign-out
 * leaves one orphan session row whose tokens never left server memory, so it
 * is logged rather than failing the request.
 */
export async function passwordMatches(email: string, password: string, context: string): Promise<boolean> {
  const verifier = createAnonServerClient()
  const { error } = await verifier.auth.signInWithPassword({ email, password })
  if (error) return false
  const { error: signOutError } = await verifier.auth.signOut({ scope: 'local' })
  if (signOutError) console.error(`${context}: verifier sign-out failed`, signOutError.message)
  return true
}
