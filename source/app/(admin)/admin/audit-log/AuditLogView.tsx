"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { AdminRole } from "@/lib/auth/types";
import { exportAuditLogCSV, type AuditLogRow } from "./actions";
import type { AuditAction } from "@/lib/auth/audit";

interface Props {
  user: User;
  role: AdminRole;
  initial: { rows: AuditLogRow[]; total: number };
  initialFilters: Record<string, string | undefined>;
  pageSize: number;
}

/**
 * Action filter groups. Adding a new AuditAction requires updating both this
 * list and the AuditAction union in src/lib/auth/audit.ts.
 */
const ACTION_GROUPS: { label: string; actions: string }[] = [
  { label: "All actions", actions: "" },
  {
    label: "Posts",
    actions:
      "blog_post.create,blog_post.update,blog_post.delete,blog_post.publish,blog_post.unpublish,blog_post.duplicate",
  },
  { label: "Jobs", actions: "job.create,job.update,job.delete" },
  {
    label: "Testimonials",
    actions:
      "testimonial.create,testimonial.update,testimonial.delete,testimonial.approve",
  },
  {
    label: "Redirects",
    actions: "redirect.create,redirect.update,redirect.delete",
  },
  {
    label: "User management",
    actions:
      "user.invite,user.role_change,user.deactivate,user.reactivate,user.recover_password",
  },
  { label: "Auth login", actions: "auth.login_success" },
  {
    label: "MFA events",
    actions:
      "auth.mfa.enrolled,auth.mfa.verified,auth.mfa.recovery_code_used,auth.mfa.disabled,auth.mfa.regenerated_codes,auth.mfa.reset_by_operator",
  },
  { label: "Audit log exports", actions: "audit_log.export_csv" },
];

export function AuditLogView({ initial, initialFilters, pageSize }: Props) {
  const router = useRouter();
  const [isExporting, startExport] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(initial.total / pageSize));
  const currentPage = Math.max(1, parseInt(initialFilters.page ?? "1", 10) || 1);

  // Strip undefined keys so URLSearchParams below stays clean.
  const baseFilters: Record<string, string> = {};
  for (const [k, v] of Object.entries(initialFilters)) {
    if (v !== undefined && v !== "") baseFilters[k] = v;
  }

  const updateFilters = (next: Record<string, string>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
    }
    router.push(`/admin/audit-log?${params.toString()}`);
  };

  const onExport = () => {
    startExport(async () => {
      const result = await exportAuditLogCSV({
        actor_user_ids: initialFilters.actor?.split(",").filter(Boolean),
        actions: initialFilters.action
          ?.split(",")
          .filter(Boolean) as AuditAction[] | undefined,
        resource_types: initialFilters.resource?.split(",").filter(Boolean),
        start_date: initialFilters.start,
        end_date: initialFilters.end,
        search: initialFilters.q,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const csv = result.data ?? "";
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `acme-audit-log-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Audit log exported");
    });
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1
            className="text-2xl font-black"
            style={{ fontFamily: "var(--font-display)" }}
          >
            AUDIT LOG
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            {initial.total.toLocaleString()} events · last 24 months retained
          </p>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={isExporting}
          className="btn-primary px-5 py-2.5 text-sm font-bold disabled:opacity-50"
        >
          {isExporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4 mb-4">
        <div>
          <label
            className="block text-xs uppercase text-text-muted mb-1"
            htmlFor="audit-q"
          >
            Search
          </label>
          <input
            id="audit-q"
            type="search"
            placeholder="Actor email or resource ID…"
            defaultValue={initialFilters.q ?? ""}
            onBlur={(e) =>
              updateFilters({
                ...baseFilters,
                q: e.target.value,
                page: "1",
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                updateFilters({
                  ...baseFilters,
                  q: (e.target as HTMLInputElement).value,
                  page: "1",
                });
              }
            }}
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-white"
          />
        </div>
        <div>
          <label
            className="block text-xs uppercase text-text-muted mb-1"
            htmlFor="audit-start"
          >
            Start date
          </label>
          <input
            id="audit-start"
            type="date"
            defaultValue={initialFilters.start ?? ""}
            onChange={(e) =>
              updateFilters({
                ...baseFilters,
                start: e.target.value,
                page: "1",
              })
            }
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-white"
          />
        </div>
        <div>
          <label
            className="block text-xs uppercase text-text-muted mb-1"
            htmlFor="audit-end"
          >
            End date
          </label>
          <input
            id="audit-end"
            type="date"
            defaultValue={initialFilters.end ?? ""}
            onChange={(e) =>
              updateFilters({
                ...baseFilters,
                end: e.target.value,
                page: "1",
              })
            }
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-white"
          />
        </div>
        <div>
          <label
            className="block text-xs uppercase text-text-muted mb-1"
            htmlFor="audit-action"
          >
            Action group
          </label>
          <select
            id="audit-action"
            defaultValue={initialFilters.action ?? ""}
            onChange={(e) =>
              updateFilters({
                ...baseFilters,
                action: e.target.value,
                page: "1",
              })
            }
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-white"
          >
            {ACTION_GROUPS.map((g) => (
              <option key={g.label} value={g.actions}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block border border-border rounded-lg overflow-hidden bg-bg-white">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated border-b border-border">
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted">
              <th className="px-3 py-3">When</th>
              <th className="px-3 py-3">Actor</th>
              <th className="px-3 py-3">Action</th>
              <th className="px-3 py-3">Resource</th>
              <th className="px-3 py-3">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {initial.rows.map((r) => {
              const isOpen = expandedId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => setExpandedId(isOpen ? null : r.id)}
                    className="cursor-pointer hover:bg-bg-elevated/50"
                  >
                    <td className="px-3 py-3 text-xs text-text-secondary whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-text-primary">{r.actor_email}</div>
                      <div className="text-xs text-text-muted">
                        {r.actor_role ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{r.action}</td>
                    <td className="px-3 py-3 text-xs">
                      {r.resource_type ?? "—"}
                      {r.resource_id ? ` · ${r.resource_id.slice(0, 8)}` : ""}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {r.ip_address ?? "—"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-bg-elevated/30">
                      <td colSpan={5} className="px-3 py-4">
                        <pre className="whitespace-pre-wrap text-xs text-text-primary">
                          {JSON.stringify(r.payload, null, 2)}
                        </pre>
                        {r.user_agent && (
                          <div className="mt-2 text-xs text-text-muted break-all">
                            <span className="font-semibold uppercase tracking-wider">
                              User-Agent:
                            </span>{" "}
                            {r.user_agent}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="md:hidden space-y-3">
        {initial.rows.map((r) => {
          const isOpen = expandedId === r.id;
          return (
            <li
              key={r.id}
              className="border border-border rounded-lg bg-bg-white p-4"
              onClick={() => setExpandedId(isOpen ? null : r.id)}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-text-primary truncate">
                  {r.actor_email}
                </span>
                <span className="text-xs text-text-muted whitespace-nowrap">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="text-xs text-text-secondary mt-1">
                {r.actor_role ?? "—"} ·{" "}
                <span className="font-mono">{r.action}</span>
              </div>
              <div className="text-xs text-text-muted mt-1">
                {r.resource_type ?? "—"}
                {r.resource_id ? ` · ${r.resource_id.slice(0, 8)}` : ""}
              </div>
              {isOpen && (
                <div className="mt-3 pt-3 border-t border-border">
                  <pre className="whitespace-pre-wrap text-xs text-text-primary">
                    {JSON.stringify(r.payload, null, 2)}
                  </pre>
                  {r.user_agent && (
                    <div className="mt-2 text-xs text-text-muted break-all">
                      <span className="font-semibold uppercase tracking-wider">
                        User-Agent:
                      </span>{" "}
                      {r.user_agent}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {initial.rows.length === 0 && (
        <p className="text-center text-text-muted mt-8">
          No matching audit events.
        </p>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() =>
              updateFilters({
                ...baseFilters,
                page: String(currentPage - 1),
              })
            }
            className="text-accent hover:underline disabled:text-text-muted disabled:no-underline disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-text-secondary">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() =>
              updateFilters({
                ...baseFilters,
                page: String(currentPage + 1),
              })
            }
            className="text-accent hover:underline disabled:text-text-muted disabled:no-underline disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
