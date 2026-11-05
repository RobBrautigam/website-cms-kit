// /sitemap.xml: every registered public page and every live post, with its
// last change and featured image. Rules: lib/seo/sitemap.ts; model: docs/14.
import type { MetadataRoute } from 'next'
import { getBlogSitemapEntries } from '@/lib/data'
import { PUBLIC_ROUTES } from '@/lib/seo/routes'
import { siteConfig } from '@/lib/seo/site'
import { buildSitemap } from '@/lib/seo/sitemap'

export const revalidate = 3600

// The posts come from a narrow read that throws on a database error, and this
// file does not catch it (since 1.7.0): Next.js keeps serving the last good
// sitemap when a regeneration fails, where a caught error would cache a
// sitemap with no posts for the whole revalidate window. A build that cannot
// reach the database fails here (docs/14).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteConfig()
  const posts = await getBlogSitemapEntries()
  return buildSitemap({ site, routes: PUBLIC_ROUTES, posts })
}
