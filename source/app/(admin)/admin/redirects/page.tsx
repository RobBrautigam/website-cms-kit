import Link from "next/link";
import { Search, ChevronDown } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require";
import {
  fetchAllRedirects,
  fetchDistinctCategories,
  type SortKey,
} from "@/lib/redirects/queries";
import RowDeleteButton from "@/components/admin/RowDeleteButton";
import ToggleButton from "@/components/admin/ToggleButton";
import { deleteRedirect, toggleRedirectEnabled } from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const VALID_SORTS: SortKey[] = ["last_hit", "alphabetical", "newest", "most_hits"];

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "warning" | "info" | "muted" }) {
  const tones: Record<string, string> = {
    default: "bg-bg-elevated text-text-secondary",
    warning: "bg-amber-100 text-amber-700",
    info: "bg-accent/15 text-accent",
    muted: "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${tones[tone]}`}>
      {children}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = 60_000, h = 60 * m, d = 24 * h;
  if (diff < m) return "just now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 30 * d) return `${Math.floor(diff / d)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function sortLabel(s: SortKey): string {
  switch (s) {
    case "last_hit": return "most recently hit";
    case "alphabetical": return "alphabetical (source)";
    case "newest": return "newest";
    case "most_hits": return "most hits";
  }
}

interface PageProps {
  searchParams: Promise<{ q?: string; cat?: string; sort?: string; page?: string }>;
}

export default async function AdminRedirectsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const supabase = await createServerSupabaseClient();
  const sort: SortKey = VALID_SORTS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : "last_hit";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const search = sp.q?.trim() || undefined;
  const categoryFilter = sp.cat === "__none__" ? null : sp.cat || undefined;

  const [{ rows, totalCount }, categories] = await Promise.all([
    fetchAllRedirects(supabase, { search, category: categoryFilter, sort, page, pageSize: PAGE_SIZE }),
    fetchDistinctCategories(supabase),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Suffixed IDs prevent duplicate `id="q"` etc. when both forms render at SSR.
  // Both forms post to the same handler and use the same input `name`s, so URL
  // params are identical regardless of which form submits.
  const renderFilterControls = (idSuffix: string) => (
    <>
      <div className="w-full md:flex-1 md:min-w-[240px]">
        <label className="block text-xs uppercase text-text-muted mb-1" htmlFor={`q${idSuffix}`}>Search</label>
        <input
          id={`q${idSuffix}`} name="q" type="search" defaultValue={search ?? ""}
          placeholder="Source, destination, notes, category…"
          className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-white"
        />
      </div>
      <div className="w-full md:w-auto">
        <label className="block text-xs uppercase text-text-muted mb-1" htmlFor={`cat${idSuffix}`}>Category</label>
        <select id={`cat${idSuffix}`} name="cat" defaultValue={sp.cat ?? ""} className="w-full md:w-auto px-3 py-2 text-sm border border-border rounded-md bg-bg-white">
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          <option value="__none__">(uncategorized)</option>
        </select>
      </div>
      <div className="w-full md:w-auto">
        <label className="block text-xs uppercase text-text-muted mb-1" htmlFor={`sort${idSuffix}`}>Sort</label>
        <select id={`sort${idSuffix}`} name="sort" defaultValue={sort} className="w-full md:w-auto px-3 py-2 text-sm border border-border rounded-md bg-bg-white">
          <option value="last_hit">Most recently hit</option>
          <option value="alphabetical">Alphabetical (source)</option>
          <option value="newest">Newest</option>
          <option value="most_hits">Most hits</option>
        </select>
      </div>
      <button type="submit" className="w-full md:w-auto px-4 py-2 text-sm border border-border rounded-md bg-bg-white hover:bg-bg-elevated">
        Apply
      </button>
    </>
  );

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black" style={{ fontFamily: "var(--font-display)" }}>
            URL REDIRECTS
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            {totalCount} total · sorted by {sortLabel(sort)}
          </p>
        </div>
        <Link href="/admin/redirects/new" className="btn-primary px-5 py-2.5 text-sm font-bold">
          + New Redirect
        </Link>
      </div>

      {/* Mobile filter disclosure */}
      <details className="md:hidden mb-4 group">
        <summary className="flex items-center gap-2 px-4 py-3 rounded-lg border border-border bg-bg-card text-sm font-semibold text-text-primary cursor-pointer list-none">
          <Search size={16} strokeWidth={1.75} />
          <span className="flex-1 text-left">Search & filter</span>
          <ChevronDown size={16} strokeWidth={1.75} className="transition-transform group-open:rotate-180" />
        </summary>
        <form className="mt-3 space-y-3" action="/admin/redirects" method="get">
          {renderFilterControls("-mobile")}
        </form>
      </details>

      {/* Desktop filter form */}
      <form className="hidden md:flex mb-4 flex-wrap gap-2 items-end" action="/admin/redirects" method="get">
        {renderFilterControls("")}
      </form>

      <div className="hidden md:block border border-border rounded-lg overflow-hidden bg-bg-white">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated border-b border-border">
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted">
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">Destination</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">Category</th>
              <th className="px-3 py-3 text-right">Hits</th>
              <th className="px-3 py-3">Last hit</th>
              <th className="px-3 py-3">Enabled</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-bg-elevated/50">
                <td className="px-3 py-3 font-mono text-xs">
                  <span title={r.source}>{r.source}</span>
                  {r.is_pattern && <span className="ml-2"><Chip tone="info">pattern</Chip></span>}
                </td>
                <td className="px-3 py-3 font-mono text-xs max-w-[280px] truncate" title={r.destination}>
                  {r.destination}
                </td>
                <td className="px-3 py-3">
                  {r.permanent ? <Chip>308</Chip> : <Chip tone="warning">307</Chip>}
                </td>
                <td className="px-3 py-3">
                  {r.category ? <Chip>{r.category}</Chip> : <span className="text-text-muted">—</span>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{r.hit_count.toLocaleString()}</td>
                <td className="px-3 py-3 text-xs text-text-secondary">{relativeTime(r.last_access)}</td>
                <td className="px-3 py-3">
                  <ToggleButton
                    currentValue={r.enabled}
                    onLabel="Enabled"
                    offLabel="Disabled"
                    onClass="bg-green-100 text-green-700"
                    offClass="bg-gray-100 text-gray-500"
                    action={toggleRedirectEnabled.bind(null, r.id)}
                    onSuccessCopy="Redirect enabled"
                    offSuccessCopy="Redirect disabled"
                  />
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <Link href={`/admin/redirects/${r.id}/edit`} className="text-accent hover:underline">
                      Edit
                    </Link>
                    <RowDeleteButton
                      action={deleteRedirect.bind(null, r.id)}
                      itemLabel={r.source}
                      successCopy={`Redirect deleted: ${r.source}`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <ul className="md:hidden space-y-3">
        {rows.map((r) => (
          <li
            key={r.id}
            className="border border-border rounded-lg bg-bg-white p-4"
          >
            <div className="flex items-start gap-2 flex-wrap">
              <p className="font-mono text-sm font-bold text-text-primary break-all">{r.source}</p>
              {r.is_pattern && <Chip tone="info">pattern</Chip>}
            </div>
            <p className="font-mono text-xs text-text-secondary mt-1 break-all" title={r.destination}>
              → {r.destination}
            </p>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold mb-1">Type</p>
                {r.permanent ? <Chip>308</Chip> : <Chip tone="warning">307</Chip>}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold mb-1">Category</p>
                {r.category ? <Chip>{r.category}</Chip> : <span className="text-text-muted text-xs">—</span>}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold">Hits</p>
                <p className="text-text-primary text-sm tabular-nums">{r.hit_count.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold">Last hit</p>
                <p className="text-text-secondary text-xs">{relativeTime(r.last_access)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold mb-1">Enabled</p>
                <ToggleButton
                  currentValue={r.enabled}
                  onLabel="Enabled"
                  offLabel="Disabled"
                  onClass="bg-green-100 text-green-700"
                  offClass="bg-gray-100 text-gray-500"
                  action={toggleRedirectEnabled.bind(null, r.id)}
                  onSuccessCopy="Redirect enabled"
                  offSuccessCopy="Redirect disabled"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Link
                href={`/admin/redirects/${r.id}/edit`}
                className="flex-1 flex items-center justify-center px-3 py-2 rounded-lg border border-border text-sm font-semibold text-text-primary hover:text-accent hover:bg-accent/10 transition-colors"
              >
                Edit
              </Link>
              <RowDeleteButton
                action={deleteRedirect.bind(null, r.id)}
                itemLabel={r.source}
                successCopy={`Redirect deleted: ${r.source}`}
                className="px-3 py-2 rounded-lg border border-border text-sm font-semibold text-text-secondary hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors"
              />
            </div>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <p className="text-center text-text-muted mt-8">No redirects match your filters.</p>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <PaginationLink page={page - 1} disabled={page <= 1} sp={sp} label="← Prev" />
          <span className="text-text-secondary">Page {page} of {totalPages}</span>
          <PaginationLink page={page + 1} disabled={page >= totalPages} sp={sp} label="Next →" />
        </div>
      )}
    </>
  );
}

function PaginationLink({
  page,
  disabled,
  sp,
  label,
}: {
  page: number;
  disabled: boolean;
  sp: { q?: string; cat?: string; sort?: string };
  label: string;
}) {
  if (disabled) return <span className="text-text-muted">{label}</span>;
  const params = new URLSearchParams();
  if (sp.q) params.set("q", sp.q);
  if (sp.cat) params.set("cat", sp.cat);
  if (sp.sort) params.set("sort", sp.sort);
  params.set("page", String(page));
  return (
    <Link href={`/admin/redirects?${params.toString()}`} className="text-accent hover:underline">
      {label}
    </Link>
  );
}
