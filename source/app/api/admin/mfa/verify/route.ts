import { requirePartialAdmin } from "@/lib/auth/require";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  findUnusedRecoveryCodeId,
  consumeRecoveryCodeById,
  releaseRecoveryCodeById,
  unenrollAllFactors,
} from "@/lib/auth/mfa";
import { recordAdminAction } from "@/lib/auth/audit";

export async function POST(req: Request) {
  const { user } = await requirePartialAdmin();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { method, code, factor_id, challenge_id } = body as {
    method?: "totp" | "recovery";
    code?: string;
    factor_id?: string;
    challenge_id?: string;
  };
  if (!code || !method) {
    return Response.json({ error: "Code and method are required" }, { status: 400 });
  }

  if (method === "recovery") {
    // A recovery code is an app-level construct and does NOT elevate the Supabase
    // session. If we just returned ok the user would bounce off requireAdmin's
    // aal2 gate back to this page, burning one single-use code per loop. Instead:
    // claim the code, unenroll the user's factor(s) so nextLevel drops to aal1,
    // then send them to re-enroll.
    const codeRowId = await findUnusedRecoveryCodeId(user.id, code);
    if (!codeRowId) {
      return Response.json({ error: "Invalid recovery code" }, { status: 400 });
    }

    // Claim the code atomically BEFORE the irreversible factor delete. This keeps
    // single-use honest: only one concurrent request can win, and we never report
    // success / audit a code we didn't actually mark used. A lost claim (race or
    // DB error) means the code is not ours to spend — nothing was unenrolled.
    const claimed = await consumeRecoveryCodeById(codeRowId);
    if (!claimed) {
      return Response.json({ error: "Invalid recovery code" }, { status: 400 });
    }

    const reset = await unenrollAllFactors(user.id);
    if (!reset.ok && reset.deleted === 0) {
      // Nothing was mutated (pre-delete list error, or the single delete failed):
      // release the claim so a transient admin-API error doesn't burn the code.
      await releaseRecoveryCodeById(codeRowId);
      return Response.json(
        { error: "Could not reset two-factor authentication. Please try again." },
        { status: 500 }
      );
    }

    // Full success, OR a partial unenroll (some factors deleted before a later
    // delete failed): MFA state is mutated, so the recovery code is legitimately
    // spent — do NOT release it. Record the spend, flagging partial failures so
    // operators can reconcile the user's MFA state, then drive them to re-enroll.
    await recordAdminAction({
      action: "auth.mfa.recovery_code_used",
      payload: reset.ok ? {} : { partial_unenroll_failure: true, deleted: reset.deleted },
    });
    return Response.json({ ok: true, redirect: "/admin/security/enroll" });
  }

  if (!factor_id || !challenge_id) {
    return Response.json(
      { error: "factor_id and challenge_id are required for TOTP" },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase.auth.mfa.verify({
    factorId: factor_id,
    challengeId: challenge_id,
    code,
  });
  if (result.error) {
    return Response.json({ error: "Wrong code. Try the next one." }, { status: 400 });
  }
  await recordAdminAction({ action: "auth.mfa.verified" });
  return Response.json({ ok: true });
}
