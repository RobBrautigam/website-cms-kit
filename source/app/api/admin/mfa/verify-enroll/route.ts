import { requirePartialAdmin } from "@/lib/auth/require";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { regenerateRecoveryCodes } from "@/lib/auth/mfa";
import { recordAdminAction } from "@/lib/auth/audit";

export async function POST(req: Request) {
  const { user } = await requirePartialAdmin();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const factor_id = (body as { factor_id?: string }).factor_id;
  const code = (body as { code?: string }).code;
  if (!factor_id || !code) {
    return Response.json(
      { error: "factor_id and code are required" },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabaseClient();
  const challenge = await supabase.auth.mfa.challenge({ factorId: factor_id });
  if (challenge.error || !challenge.data) {
    return Response.json(
      { error: challenge.error?.message ?? "Could not start challenge" },
      { status: 400 }
    );
  }

  const verify = await supabase.auth.mfa.verify({
    factorId: factor_id,
    challengeId: challenge.data.id,
    code,
  });
  if (verify.error) {
    return Response.json(
      { error: "That code didn't match. Try the next 30-second code." },
      { status: 400 }
    );
  }

  const recoveryCodes = await regenerateRecoveryCodes(user.id);
  await recordAdminAction({ action: "auth.mfa.enrolled" });

  return Response.json({ recovery_codes: recoveryCodes });
}
