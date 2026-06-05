import { requireAdmin } from '@/lib/auth/require'
import SitemapView, { type RouteGroup } from '@/components/admin/SitemapView'

export const dynamic = 'force-dynamic'

// Manually-maintained admin route list. When you add a new admin or core page,
// add it here. The canonical sitemap consumed by search engines is generated
// separately at `src/app/sitemap.ts`.
//
// To wire in dynamic routes (blog posts, jobs, etc.) from your data source,
// fetch them in this server component and map them into a RouteGroup the same
// way the static groups are defined below.

export default async function SitemapPage() {
  await requireAdmin()

  const groups: RouteGroup[] = [
    {
      title: 'Core Pages',
      routes: [
        { path: '/', label: 'Home' },
        { path: '/blog', label: 'Blog' },
        { path: '/about', label: 'About' },
        { path: '/careers', label: 'Careers' },
        { path: '/privacy', label: 'Privacy Policy' },
        { path: '/terms', label: 'Terms of Service' },
      ],
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
        <strong className="text-text-primary">Manually maintained.</strong>{' '}
        The route catalog below is hand-edited. When you add a new page, edit
        <code className="mx-1 px-1 py-0.5 rounded bg-bg-elevated font-mono">
          src/app/(admin)/admin/sitemap/page.tsx
        </code>
        to add it here. Search-engine sitemap is generated separately at{' '}
        <code className="font-mono">/sitemap.xml</code>.
      </aside>
      <SitemapView groups={groups} totalRoutes={totalRoutes} />
    </>
  )
}
