import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Discriminated union returned by every admin mutating server action.
 *
 * `ok: true` may carry a typed `data` payload.
 * `ok: false` always carries a human-readable `error` plus an optional
 * programmatic `code` for branching at the call site.
 */
export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string; code: ActionErrorCode };

export type ActionErrorCode =
  | "validation"
  | "conflict"
  | "not_found"
  | "unauthorized"
  | "server";

/** Factory: success without a payload. */
export function ok(): { ok: true };
/** Factory: success with a typed payload. */
export function ok<T>(data: T): { ok: true; data: T };
export function ok<T>(data?: T): { ok: true; data?: T } {
  return data === undefined ? { ok: true } : { ok: true, data };
}

/** Factory: failure with a human message and optional code (defaults to "server"). */
export function err(
  error: string,
  code: ActionErrorCode = "server"
): { ok: false; error: string; code: ActionErrorCode } {
  return { ok: false, error, code };
}

/**
 * Maps a Supabase PostgrestError to an `ActionResult` failure. Returns `null`
 * when the input is null (so call sites can early-return on success):
 *
 *   const wrapped = wrapSupabaseError(error);
 *   if (wrapped) return wrapped;
 *
 * The optional `conflictMessage` overrides the default 23505 copy. Useful for
 * actions that can pinpoint the conflicting field for the user.
 */
export function wrapSupabaseError(
  error: PostgrestError | null,
  conflictMessage?: string
): { ok: false; error: string; code: ActionErrorCode } | null {
  if (!error) return null;
  if (error.code === "23505") {
    return err(conflictMessage ?? "That value already exists.", "conflict");
  }
  if (error.code === "23503") {
    return err("Cannot delete: still referenced elsewhere.", "conflict");
  }
  if (error.code === "42501") {
    // Postgres "permission denied" — almost always Supabase RLS rejecting an
    // expired/downgraded session. Surface as `unauthorized` so the call site
    // can decide whether to redirect to login or just toast. Without this
    // branch, RLS denials surface as raw error text and confuse the user.
    return err("Permission denied. Please sign in again.", "unauthorized");
  }
  return err(error.message || "Server error. Try again.", "server");
}
