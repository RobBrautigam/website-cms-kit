import { requirePartialAdmin } from "@/lib/auth/require";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// audit:exempt — initiates a TOTP challenge; the audit row is written by the verify endpoint
export async function POST() {
  await requirePartialAdmin();
  const supabase = await createServerSupabaseClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    return Response.json({ error: listError.message }, { status: 400 });
  }
  const totp = factors?.totp?.find((f) => f.status === "verified");
  if (!totp) {
    return Response.json({ error: "No TOTP factor enrolled" }, { status: 400 });
  }
  const challenge = await supabase.auth.mfa.challenge({ factorId: totp.id });
  if (challenge.error) {
    return Response.json({ error: challenge.error.message }, { status: 400 });
  }
  return Response.json({ factor_id: totp.id, challenge_id: challenge.data.id });
}
