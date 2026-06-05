import { requireAdmin } from "@/lib/auth/require";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deleteAllRecoveryCodes } from "@/lib/auth/mfa";
import { recordAdminAction } from "@/lib/auth/audit";

export async function POST(req: Request) {
  const { user } = await requireAdmin();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const factor_id = (body as { factor_id?: string }).factor_id;
  const password = (body as { password?: string }).password;
  if (!factor_id || !password) {
    return Response.json(
      { error: "factor_id and password are required" },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabaseClient();
  // Re-authenticate with password before letting them disable a security factor
  const reauth = await supabase.auth.signInWithPassword({
    email: user.email!,
    password,
  });
  if (reauth.error) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }

  const { error: unenrollError } = await supabase.auth.mfa.unenroll({
    factorId: factor_id,
  });
  if (unenrollError) {
    return Response.json({ error: unenrollError.message }, { status: 400 });
  }

  await deleteAllRecoveryCodes(user.id);
  await recordAdminAction({ action: "auth.mfa.disabled" });

  return Response.json({ ok: true });
}
