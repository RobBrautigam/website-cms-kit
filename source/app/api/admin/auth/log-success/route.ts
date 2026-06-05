import { requirePartialAdmin } from "@/lib/auth/require";
import { recordAdminAction } from "@/lib/auth/audit";

/**
 * Authenticated audit endpoint for successful admin logins. Called
 * fire-and-forget from the LoginForm client AFTER signInWithPassword
 * succeeds. The session cookie is already set at that point, so
 * requirePartialAdmin can verify the caller is a real, active admin —
 * forged inputs from anonymous callers are rejected with the standard
 * unauthenticated redirect chain.
 *
 * Failed-login attempts are NOT logged here. Supabase's native
 * auth.audit_log_entries table records those, and accepting unauthenticated
 * "I failed to log in as X" claims from any caller would let attackers
 * pollute the audit log. See the deleted /api/admin/auth/log-attempt route
 * for the prior design.
 */
export async function POST() {
  // requirePartialAdmin (not requireAdmin) is intentional: at the moment
  // this endpoint is called, the session is aal1 and the user may not yet
  // have a verified factor. The MFA gate runs AFTER login routing.
  await requirePartialAdmin();
  await recordAdminAction({ action: "auth.login_success" });
  return new Response(null, { status: 204 });
}
