"use server";

import { requireSuperAdmin } from "@/lib/auth/require";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { recordAdminAction, type AuditAction } from "@/lib/auth/audit";
import {
  ok,
  type ActionResult,
  wrapSupabaseError,
} from "@/lib/admin/action-result";

export interface AuditLogRow {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string;
  actor_role: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: Record<string, unknown>;
}

export interface AuditLogFilters {
  actor_user_ids?: string[];
  actions?: AuditAction[];
  resource_types?: string[];
  start_date?: string;
  end_date?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;
const EXPORT_LIMIT = 10000;

// audit:exempt — read-only audit log query
export async function listAuditLog(
  filters: AuditLogFilters
): Promise<ActionResult<{ rows: AuditLogRow[]; total: number }>> {
  await requireSuperAdmin();
  const supabase = await createServerSupabaseClient();

  const pageSize = Math.min(
    filters.page_size ?? PAGE_SIZE_DEFAULT,
    PAGE_SIZE_MAX
  );
  const page = Math.max(filters.page ?? 1, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("admin_audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.actor_user_ids?.length) {
    query = query.in("actor_user_id", filters.actor_user_ids);
  }
  if (filters.actions?.length) {
    query = query.in("action", filters.actions);
  }
  if (filters.resource_types?.length) {
    query = query.in("resource_type", filters.resource_types);
  }
  if (filters.start_date) {
    query = query.gte("created_at", filters.start_date);
  }
  if (filters.end_date) {
    query = query.lte("created_at", filters.end_date);
  }
  if (filters.search) {
    // Escape PostgREST ilike wildcards so the term is matched literally.
    const term = filters.search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `actor_email.ilike.%${term}%,resource_id.ilike.%${term}%`
    );
  }

  const { data, error, count } = await query;
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;

  return ok({ rows: (data ?? []) as AuditLogRow[], total: count ?? 0 });
}

// audit:exempt — meta-event recorded explicitly below; no row mutations
export async function exportAuditLogCSV(
  filters: AuditLogFilters
): Promise<ActionResult<string>> {
  await requireSuperAdmin();
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("admin_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);

  if (filters.actor_user_ids?.length) {
    query = query.in("actor_user_id", filters.actor_user_ids);
  }
  if (filters.actions?.length) {
    query = query.in("action", filters.actions);
  }
  if (filters.resource_types?.length) {
    query = query.in("resource_type", filters.resource_types);
  }
  if (filters.start_date) {
    query = query.gte("created_at", filters.start_date);
  }
  if (filters.end_date) {
    query = query.lte("created_at", filters.end_date);
  }

  const { data, error } = await query;
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;

  const rows = (data ?? []) as AuditLogRow[];

  await recordAdminAction({
    action: "audit_log.export_csv",
    payload: { row_count: rows.length, filters },
  });

  const header = [
    "id",
    "created_at",
    "actor_email",
    "actor_role",
    "action",
    "resource_type",
    "resource_id",
    "ip_address",
    "user_agent",
    "payload",
  ];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "string" ? v : JSON.stringify(v);
    // Neutralize CSV/spreadsheet formula injection: a value starting with
    // = + - @ (or tab/CR) is run as a formula when opened in Excel/Sheets.
    // actor_email / user_agent / resource_id partly originate from request
    // input, so prefix any such value with a single quote.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.created_at,
        r.actor_email,
        r.actor_role,
        r.action,
        r.resource_type,
        r.resource_id,
        r.ip_address,
        r.user_agent,
        r.payload,
      ]
        .map(escape)
        .join(",")
    );
  }

  return ok(lines.join("\n"));
}
