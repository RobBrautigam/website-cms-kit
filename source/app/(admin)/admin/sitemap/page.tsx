import { requireAdmin } from '@/lib/auth/require'
import SitemapView, { type RouteGroup } from '@/components/admin/SitemapView'
import { PUBLIC_ROUTES } from '@/lib/seo/routes'

export const dynamic = 'force-dynamic'

// The core pages come from the public page registry (lib/seo/routes.ts), the
// same list `app/sitemap.ts` and `app/llms.txt` read, so the three cannot
// drift. The admin pages below are maintained here by hand.
//
// To wire in dynamic routes (blog posts, jobs, etc.) from your data source,
// fetch them in this server component and map them into a RouteGroup the same
// way the static groups are defined below.

export default async function SitemapPage() {
  await requireAdmin()

  const groups: RouteGroup[] = [
    {
      title: 'Core Pages',
      routes: PUBLIC_ROUTES.map((r) => ({ path: r.path, label: r.title })),
    },
    {
      title: 'Admin Pages',
      routes: [
        { path: '/admin', label: 'Dashboard' },
        { path: '/admin/posts', label: 'Posts' },
        { path: '/admin/posts/new', label: 'New Post' },
        { path: '/admin/jobs', label: 'Jobs' },
        { path: '/admin/testimonials', label: 'Testimonials' },
        { path: '/admin/redirects', label: 'Redirects' },
        { path: '/admin/sitemap', label: 'Sitemap' },
        { path: '/admin/team', label: 'Team' },
        { path: '/admin/settings', label: 'Settings' },
        { path: '/admin/audit-log', label: 'Audit Log' },
        { path: '/admin/help', label: 'Help' },
        { path: '/admin/login', label: 'Login' },
      ],
    },
  ]

  const totalRoutes = groups.reduce((sum, g) => sum + g.routes.length, 0)

  return (
    <>
      <aside
        role="note"
        className="mb-6 px-4 py-3 rounded-lg border text-xs bg-bg-card border-border text-text-secondary"
      >
        <strong className="text-text-primary">One registry.</strong>{' '}
        Core pages come from
        <code className="mx-1 px-1 py-0.5 rounded bg-bg-elevated font-mono">
          src/lib/seo/routes.ts
        </code>
        , the same list{' '}
        <code className="font-mono">/sitemap.xml</code> and{' '}
        <code className="font-mono">/llms.txt</code> read, with every live post
        added from the database. Admin pages are listed here by hand.
      </aside>
      <SitemapView groups={groups} totalRoutes={totalRoutes} />
    </>
  )
}
