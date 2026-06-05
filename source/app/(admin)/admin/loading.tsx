/**
 * Route-group loading skeleton for /admin/* (excluding the public auth pages
 * outside this group). Renders inside AdminShell as the streaming fallback
 * while the page's server component fetches data. Matches the shape of a
 * typical admin list page: header bar + filter row + table-shape rows. Gives
 * visible feedback during long-running queries instead of a blank canvas.
 */
export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label="Loading">
      <span className="sr-only">Loading…</span>
      <div className="flex items-center justify-between mb-8">
        <div className="h-7 w-48 rounded bg-bg-card animate-pulse" />
        <div className="h-9 w-32 rounded-lg bg-bg-card animate-pulse" />
      </div>
      <div className="border border-border rounded-lg overflow-hidden bg-bg-white">
        <div className="bg-bg-elevated border-b border-border px-4 py-3 flex gap-6">
          {[120, 80, 80, 60, 70].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded bg-border animate-pulse"
              style={{ width: w }}
            />
          ))}
        </div>
        <div className="divide-y divide-border">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="px-4 py-4 flex gap-6 items-center">
              <div className="h-4 w-40 rounded bg-bg-card animate-pulse" />
              <div className="h-4 w-32 rounded bg-bg-card animate-pulse" />
              <div className="h-4 w-24 rounded bg-bg-card animate-pulse" />
              <div className="h-4 w-16 rounded bg-bg-card animate-pulse" />
              <div className="h-4 w-20 rounded bg-bg-card animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
