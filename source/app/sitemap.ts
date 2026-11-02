// /sitemap.xml: every registered public page and every live post, with its
// last change and featured image. Rules: lib/seo/sitemap.ts; model: docs/14.
import type { MetadataRoute } from 'next'
import { getBlogSitemapEntries } from '@/lib/data'
import { PUBLIC_ROUTES } from '@/lib/seo/routes'
import { siteConfig } from '@/lib/seo/site'
import { buildSitemap, type SitemapPost } from '@/lib/seo/sitemap'

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteConfig()
  let posts: SitemapPost[] = []
  try {
    posts = await getBlogSitemapEntries()
  } catch (e) {
    // A database outage still serves the static pages rather than an error.
    console.error('sitemap: could not read posts', e)
  }
  return buildSitemap({ site, routes: PUBLIC_ROUTES, posts })
}
