/**
 * The sitemap, robots.txt and llms.txt, as pure builders. The route files in
 * `app/` only read data and call these, so the rules are tested without a
 * server.
 */
import type { MetadataRoute } from 'next'
import { absoluteUrl, canonicalUrl, isPublicPost, postPath, type SiteConfig } from './site'

export type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'

/** A page of the site that is not a post. Register every public page here. */
export type PublicRoute = {
  path: string
  title: string
  changeFrequency?: ChangeFrequency
  priority?: number
  /** Kept out of the sitemap and llms.txt (a thank-you page, a form result). */
  noindex?: boolean
}

/** The fields the sitemap reads for a post (`getBlogSitemapEntries()`). */
export type SitemapPost = {
  slug: string
  featuredImage?: string | null
  updatedAt?: string | null
  publishedAt?: string | null
  status: string | null
  unpublishAt?: string | null
}

export function buildSitemap(input: {
  site: SiteConfig
  routes: PublicRoute[]
  posts: SitemapPost[]
  now?: Date
}): MetadataRoute.Sitemap {
  const { site, routes, posts } = input
  if (site.noindex) return []
  const now = input.now ?? new Date()
  const seen = new Set<string>()
  const out: MetadataRoute.Sitemap = []

  for (const r of routes) {
    if (r.noindex) continue
    const url = canonicalUrl(r.path, site)
    if (seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      changeFrequency: r.changeFrequency ?? 'weekly',
      priority: r.priority ?? 0.5,
    })
  }

  for (const p of posts) {
    if (!p.slug || !isPublicPost({ status: p.status, publishedAt: p.publishedAt, unpublishAt: p.unpublishAt }, now)) continue
    const url = canonicalUrl(postPath(p.slug), site)
    if (seen.has(url)) continue
    seen.add(url)
    const lastModified = p.updatedAt || p.publishedAt
    const image = absoluteUrl(p.featuredImage, site)
    out.push({
      url,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: 'monthly',
      priority: 0.6,
      ...(image ? { images: [image] } : {}),
    })
  }

  return out
}

/**
 * robots.txt. With the noindex switch on, everything is disallowed and no
 * sitemap is named; otherwise the admin and the API are kept out and the
 * sitemap is named by its absolute address.
 */
export function buildRobots(site: SiteConfig): MetadataRoute.Robots {
  if (site.noindex) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] }],
    sitemap: canonicalUrl('/sitemap.xml', site),
    host: site.url,
  }
}

function oneLine(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * llms.txt (llmstxt.org): a short Markdown map of the site for language-model
 * readers. It prints only what the site's own settings and live posts hold:
 * no contact line unless one is passed in, no post that is not live.
 */
export function buildLlmsTxt(input: {
  site: SiteConfig
  routes: PublicRoute[]
  posts: (SitemapPost & { title: string; excerpt?: string | null })[]
  contact?: string
  now?: Date
}): string {
  const { site, routes, posts } = input
  const now = input.now ?? new Date()
  const lines: string[] = [`# ${oneLine(site.name)}`, '']
  if (site.description) lines.push(`> ${oneLine(site.description)}`, '')

  const pages = routes.filter((r) => !r.noindex)
  if (pages.length) {
    lines.push('## Pages', '')
    for (const r of pages) lines.push(`- [${oneLine(r.title)}](${canonicalUrl(r.path, site)})`)
    lines.push('')
  }

  const live = posts.filter((p) => p.slug && isPublicPost({ status: p.status, publishedAt: p.publishedAt, unpublishAt: p.unpublishAt }, now))
  if (live.length) {
    lines.push('## Posts', '')
    for (const p of live) {
      const note = oneLine(p.excerpt)
      lines.push(`- [${oneLine(p.title)}](${canonicalUrl(postPath(p.slug), site)})${note ? `: ${note}` : ''}`)
    }
    lines.push('')
  }

  const contact = oneLine(input.contact)
  if (contact) lines.push('## Contact', '', `- ${contact}`, '')
  return lines.join('\n')
}
