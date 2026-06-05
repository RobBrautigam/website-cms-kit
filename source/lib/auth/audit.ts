import { headers } from "next/headers";
import {
  createServiceClient,
  createServerSupabaseClient,
} from "@/lib/supabase/server";
import type { AdminRole } from "./types";

/**
 * Every action recorded in the admin audit log. Adding a new action requires
 * updating both this union AND the action filter <select> on the audit log
 * page (src/app/(admin)/admin/audit-log/AuditLogView.tsx).
 */
export type AuditAction =
  // Mutations
  | "blog_post.create"
  | "blog_post.update"
  | "blog_post.delete"
  | "blog_post.publish"
  | "blog_post.unpublish"
  | "blog_post.duplicate"
  | "job.create"
  | "job.update"
  | "job.delete"
  | "testimonial.create"
  | "testimonial.update"
  | "testimonial.delete"
  | "testimonial.approve"
  | "redirect.create"
  | "redirect.update"
  | "redirect.delete"
  // Permission changes (super_admin only)
  | "user.invite"
  | "user.role_change"
  | "user.deactivate"
  | "user.reactivate"
  | "user.recover_password"
  // Auth events
  // Note: failed login attempts are recorded by Supabase's native
  // auth.audit_log_entries table, not here. Accepting unauthenticated
  // "I failed to log in" claims from any caller would let attackers
  // pollute our audit log.
  | "auth.login_success"
  | "auth.mfa.enrolled"
  | "auth.mfa.verified"
  | "auth.mfa.recovery_code_used"
  | "auth.mfa.disabled"
  | "auth.mfa.regenerated_codes"
  | "auth.mfa.reset_by_operator"
  // Meta
  | "audit_log.export_csv";

export interface RecordAdminActionInput {
  action: AuditAction;
  resource_type?: string;
  resource_id?: string;
  payload?: Record<string, unknown>;
  /**
   * Override the actor. Used in the break-glass operator script and other
   * server-side flows where the session lookup wouldn't return the right
   * user (e.g., user.recover_password initiated by an admin against another
   * user's account).
   */
  actor_user_id?: string;
  actor_email?: string;
  actor_role?: AdminRole | "system";
}

/**
 * Append a row to admin_audit_log. Best-effort: insert failures log to
 * console.error but never throw — losing an audit row is preferable to
 * breaking a mutation.
 *
 * Extracts the client IP — preferring the edge-set `cf-connecting-ip` (Cloudflare
 * populates it and the client cannot spoof it), falling back to `x-real-ip` then
 * the first `x-forwarded-for` hop for non-Cloudflare / local environments — and the
 * user-agent, when available. The first XFF hop alone is client-spoofable, so it is
 * the last resort, not the primary source.
 */
export async function recordAdminAction(
  input: RecordAdminActionInput
): Promise<void> {
  try {
    const h = await headers();
    let actor_user_id = input.actor_user_id;
    let actor_email = input.actor_email;

    if (!actor_user_id) {
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        actor_user_id = user.id;
        actor_email = actor_email ?? user.email ?? "(unknown)";
      } else {
        actor_email = actor_email ?? "(unknown)";
      }
    } else {
      actor_email = actor_email ?? "(unknown)";
    }

    const ip =
      h.get("cf-connecting-ip") ??
      h.get("x-real-ip") ??
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;

    const svc = createServiceClient();
    const { error } = await svc.from("admin_audit_log").insert({
      actor_user_id,
      actor_email,
      actor_role: input.actor_role,
      action: input.action,
      resource_type: input.resource_type,
      resource_id: input.resource_id,
      payload: input.payload ?? {},
      ip_address: ip,
      user_agent: h.get("user-agent"),
    });

    if (error) {
      console.error("[audit] insert failed", {
        action: input.action,
        error: error.message,
      });
    }
  } catch (e) {
    console.error("[audit] unexpected error", {
      action: input.action,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
