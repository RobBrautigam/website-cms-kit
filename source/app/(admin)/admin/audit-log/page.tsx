import { requireSuperAdmin } from "@/lib/auth/require";
import { listAuditLog, type AuditLogFilters } from "./actions";
import { AuditLogView } from "./AuditLogView";
import type { AuditAction } from "@/lib/auth/audit";

export const metadata = {
  title: "Audit Log | Acme Admin",
  robots: "noindex, nofollow",
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    actor?: string;
    action?: string;
    resource?: string;
    start?: string;
    end?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { user, role } = await requireSuperAdmin();
  const sp = await searchParams;

  const filters: AuditLogFilters = {
    actor_user_ids: sp.actor?.split(",").filter(Boolean),
    actions: sp.action?.split(",").filter(Boolean) as AuditAction[] | undefined,
    resource_types: sp.resource?.split(",").filter(Boolean),
    start_date: sp.start,
    end_date: sp.end,
    search: sp.q,
    page: sp.page ? parseInt(sp.page, 10) : 1,
    page_size: PAGE_SIZE,
  };

  const result = await listAuditLog(filters);
  const initial =
    result.ok && result.data ? result.data : { rows: [], total: 0 };

  return (
    <AuditLogView
      user={user}
      role={role}
      initial={initial}
      initialFilters={sp}
      pageSize={PAGE_SIZE}
    />
  );
}
