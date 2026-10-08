import { requireAdmin } from "@/lib/auth/require";
import { regenerateRecoveryCodes } from "@/lib/auth/mfa";
import { recordAdminAction } from "@/lib/auth/audit";
import { passwordMatches } from "@/lib/auth/reauth";
import { crossSiteRefusal } from "@/lib/security/request-origin";

/**
 * POST /api/admin/mfa/regenerate-codes  { password }
 *
 * New recovery codes replace the old ones, so the caller proves the password
 * first (the same re-check as turning two-factor off). Without it, a stolen
 * session could mint codes that sign in past two-factor later.
 */
export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  const { user } = await requireAdmin();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const password = (body as { password?: unknown } | null)?.password;
  if (typeof password !== "string" || password === "") {
    return Response.json({ error: "Your password is required" }, { status: 400 });
  }
  if (!(await passwordMatches(user.email!, password, "mfa/regenerate-codes"))) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  const codes = await regenerateRecoveryCodes(user.id);
  await recordAdminAction({ action: "auth.mfa.regenerated_codes" });
  return Response.json({ recovery_codes: codes });
}
