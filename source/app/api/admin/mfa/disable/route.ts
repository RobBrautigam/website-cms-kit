import { requireAdmin } from "@/lib/auth/require";
import {
  createAnonServerClient,
  createServerSupabaseClient,
} from "@/lib/supabase/server";
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

  // Re-authenticate with the password before letting them disable a security
  // factor. The check runs on a throwaway, cookie-less client: signing in on
  // the cookie client would swap this verified (AAL2) session for a fresh
  // AAL1 one, and Supabase refuses to unenroll a verified factor below AAL2.
  const verifier = createAnonServerClient();
  const reauth = await verifier.auth.signInWithPassword({
    email: user.email!,
    password,
  });
  if (reauth.error) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  // End the extra session the check created. Local scope only: a global
  // sign-out would end the user's real session too.
  await verifier.auth.signOut({ scope: "local" });

  const supabase = await createServerSupabaseClient();
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
