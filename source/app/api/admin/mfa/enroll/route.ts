import { requirePartialAdmin } from "@/lib/auth/require";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Initiates MFA enrollment; the audit row is written by the verify-enroll
// route once the user proves possession of the new factor.
// audit:exempt — enrollment kickoff is read-only-ish; verify-enroll audits.
export async function POST() {
  await requirePartialAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error || !data) {
    return Response.json(
      { error: error?.message ?? "Could not start enrollment" },
      { status: 400 }
    );
  }
  return Response.json({
    factor_id: data.id,
    qr_code: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  });
}
