import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/server";

const RECOVERY_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 10;

/**
 * Date the 2FA enforcement window opened. After
 * max(user.created_at, FEATURE_SHIP_DATE) + GRACE_DAYS, MFA is required.
 *
 * Set this to the UTC date you turn MFA enforcement on for your own
 * deployment. Users that already existed when you flipped it on get a
 * GRACE_DAYS window from this date; users created later get a GRACE_DAYS
 * window from their own created_at. The placeholder below is just an example.
 */
export const FEATURE_SHIP_DATE = new Date("2026-01-01T00:00:00Z");
export const GRACE_DAYS = 7;

/**
 * Generate 10 single-use recovery codes in xxxx-xxxx-xxxx format. Each code
 * is 12 alphanumeric chars in three groups of four. The alphabet skips
 * visually ambiguous characters (0/O, 1/l/i) so codes can be read aloud
 * over the phone if needed.
 *
 * Uses Node's crypto.randomInt (CSPRNG-backed) — recovery codes are a
 * credential and Math.random is not cryptographically secure.
 */
export function generateRecoveryCodes(): string[] {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const out = new Set<string>();
  while (out.size < RECOVERY_CODE_COUNT) {
    let code = "";
    for (let i = 0; i < 12; i++) {
      code += alphabet[randomInt(0, alphabet.length)];
      if (i === 3 || i === 7) code += "-";
    }
    out.add(code);
  }
  return Array.from(out);
}

/**
 * Hash and persist recovery codes for a user. Caller decides whether to
 * wipe existing codes first (use regenerateRecoveryCodes for the wipe-and-
 * replace pattern).
 */
export async function storeRecoveryCodes(
  user_id: string,
  codes: string[]
): Promise<void> {
  const svc = createServiceClient();
  const rows = await Promise.all(
    codes.map(async (code) => ({
      user_id,
      code_hash: await bcrypt.hash(code, BCRYPT_ROUNDS),
    }))
  );
  const { error } = await svc.from("admin_mfa_recovery_codes").insert(rows);
  if (error) throw error;
}

/**
 * Replace all of a user's recovery codes with a fresh batch. Returns the
 * new plaintext codes -- they are not retrievable later.
 */
export async function regenerateRecoveryCodes(
  user_id: string
): Promise<string[]> {
  const svc = createServiceClient();
  const { error: deleteError } = await svc
    .from("admin_mfa_recovery_codes")
    .delete()
    .eq("user_id", user_id);
  if (deleteError) throw deleteError;

  const codes = generateRecoveryCodes();
  await storeRecoveryCodes(user_id, codes);
  return codes;
}

/**
 * Find an unused recovery code matching the candidate WITHOUT consuming it.
 * Returns the row id on match, null on no match / no codes / query error.
 *
 * Used by the verify route so the code can be consumed only AFTER a successful
 * factor unenroll (see consumeRecoveryCodeById + unenrollAllFactors) — that
 * ordering is what stops a transient admin-API error from burning a single-use
 * code.
 *
 * bcrypt.compare is constant-time per hash, so timing leaks here are bounded by
 * the user's number of unused codes (10 max).
 */
export async function findUnusedRecoveryCodeId(
  user_id: string,
  candidate: string
): Promise<string | null> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("admin_mfa_recovery_codes")
    .select("id, code_hash")
    .eq("user_id", user_id)
    .is("used_at", null);
  if (error || !data) return null;

  for (const row of data) {
    const match = await bcrypt.compare(candidate, row.code_hash);
    if (match) return row.id as string;
  }
  return null;
}

/**
 * Atomically consume a single recovery code by id. Only succeeds if the row is
 * still unused: the UPDATE filters on `used_at IS NULL` and `.maybeSingle()`
 * resolves to the row actually updated, or null if a concurrent request already
 * consumed it. Returns false on race-loss or error. Guarantees single-use even
 * under concurrent submissions of the same valid code.
 */
export async function consumeRecoveryCodeById(id: string): Promise<boolean> {
  const svc = createServiceClient();
  const result = await svc
    .from("admin_mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (result.error || !result.data) return false;
  return true;
}

/**
 * Release a previously-claimed recovery code (set used_at back to null). Used by
 * the recovery login path to un-burn a code that was claimed up front but whose
 * factor unenroll then failed — so a transient admin-API error never costs the
 * user a single-use code. Safe to call only on a row this request just claimed
 * (the atomic consume guarantees a single winner, so no other request owns it).
 */
export async function releaseRecoveryCodeById(id: string): Promise<void> {
  const svc = createServiceClient();
  await svc
    .from("admin_mfa_recovery_codes")
    .update({ used_at: null })
    .eq("id", id);
}

/**
 * Verify a recovery-code candidate against the user's unused hashes and consume
 * it on match. Composition of findUnusedRecoveryCodeId + consumeRecoveryCodeById;
 * single-use is guaranteed by the atomic consume.
 */
export async function verifyAndConsumeRecoveryCode(
  user_id: string,
  candidate: string
): Promise<boolean> {
  const id = await findUnusedRecoveryCodeId(user_id, candidate);
  if (!id) return false;
  return consumeRecoveryCodeById(id);
}

/**
 * Delete ALL of a user's MFA factors via the service-role admin API. Used by the
 * recovery-code login path: removing every verified factor drops the session's
 * nextLevel to aal1, which is what stops requireAdmin's AAL gate from looping the
 * user back to the verify page.
 *
 * Attempts every factor (does NOT bail on the first delete error) so a stuck
 * factor doesn't leave the rest behind, and returns the TRUE count deleted.
 * `ok` is true only when nothing errored. The caller uses `deleted` to tell a
 * clean pre-mutation failure (`!ok && deleted === 0` — safe to retry, leave the
 * recovery code unspent) apart from a partial failure (`!ok && deleted > 0` —
 * MFA state already changed, so the code is legitimately spent).
 */
export async function unenrollAllFactors(
  user_id: string
): Promise<{ ok: boolean; deleted: number }> {
  const svc = createServiceClient();
  const factorsRes = await svc.auth.admin.mfa.listFactors({ userId: user_id });
  if (factorsRes.error) return { ok: false, deleted: 0 };
  const factors = factorsRes.data?.factors ?? [];

  let deleted = 0;
  let ok = true;
  for (const f of factors) {
    const res = await svc.auth.admin.mfa.deleteFactor({ id: f.id, userId: user_id });
    if (res.error) {
      ok = false;
      continue;
    }
    deleted += 1;
  }
  return { ok, deleted };
}

/**
 * Wipe all recovery codes for a user. Used when 2FA is disabled.
 */
export async function deleteAllRecoveryCodes(user_id: string): Promise<void> {
  const svc = createServiceClient();
  await svc.from("admin_mfa_recovery_codes").delete().eq("user_id", user_id);
}

/**
 * Determine whether MFA enrollment is hard-required for a user.
 *
 * The grace window starts at the LATER of FEATURE_SHIP_DATE and the user's
 * own created_at. Users that existed before this feature shipped get a
 * 7-day window from FEATURE_SHIP_DATE. Users created AFTER ship get a
 * 7-day window from their own creation date.
 */
export function mustEnforceMFA(userCreatedAt: Date | string | null): boolean {
  const created = userCreatedAt
    ? new Date(userCreatedAt)
    : FEATURE_SHIP_DATE;
  const start = created > FEATURE_SHIP_DATE ? created : FEATURE_SHIP_DATE;
  const cutoff = new Date(start.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  return new Date() > cutoff;
}
