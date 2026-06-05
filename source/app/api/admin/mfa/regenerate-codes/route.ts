import { requireAdmin } from "@/lib/auth/require";
import { regenerateRecoveryCodes } from "@/lib/auth/mfa";
import { recordAdminAction } from "@/lib/auth/audit";

export async function POST() {
  const { user } = await requireAdmin();
  const codes = await regenerateRecoveryCodes(user.id);
  await recordAdminAction({ action: "auth.mfa.regenerated_codes" });
  return Response.json({ recovery_codes: codes });
}
