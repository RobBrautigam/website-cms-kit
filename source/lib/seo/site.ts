/**
 * The public site's one source for its own address, name and indexing switch.
 * Every canonical, share-image URL, JSON-LD id, sitemap entry, robots line and
 * llms.txt link is built from here, never from a domain typed into a page.
 *
 * Environment (docs/14):
 *   NEXT_PUBLIC_SITE_URL          the public origin, e.g. https://www.example.com
 *   NEXT_PUBLIC_SITE_NAME         the brand name used in titles and schema
 *   NEXT_PUBLIC_SITE_DESCRIPTION  one sentence about the site (llms.txt, WebSite schema)
 *   NEXT_PUBLIC_NOINDEX           "1" or "true" keeps the whole site out of search
 *                                 (staging and preview deploys): robots.txt
 *                                 disallows everything, every page says noindex,
 *                                 and the sitemap is empty.
 */

export const BLOG_BASE_PATH = '/blog'

export type SiteConfig = {
  /** The public origin, no trailing slash. */
  url: string
  name: string
  description: string
  noindex: boolean
}

export type SiteEnv = {
  NEXT_PUBLIC_SITE_URL?: string
  NEXT_PUBLIC_SITE_NAME?: string
  NEXT_PUBLIC_SITE_DESCRIPTION?: string
  NEXT_PUBLIC_NOINDEX?: string
  NODE_ENV?: string
}

// Read each variable by its literal name, so a bundler that inlines
// NEXT_PUBLIC_* values at build time still finds them.
function readEnv(): SiteEnv {
  return {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
    NEXT_PUBLIC_SITE_DESCRIPTION: process.env.NEXT_PUBLIC_SITE_DESCRIPTION,
    NEXT_PUBLIC_NOINDEX: process.env.NEXT_PUBLIC_NOINDEX,
    NODE_ENV: process.env.NODE_ENV,
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]'])

/**
 * The origin of a site address, or a refusal. In production a missing or local
 * address is refused, because a page built with it publishes canonicals and
 * share images that point at the builder's own machine (a layout without
 * `metadataBase` does exactly that, and nothing in the page looks wrong).
 */
export function normalizeSiteUrl(raw: string | undefined, production: boolean): string {
  const value = (raw ?? '').trim()
  if (!value) {
    if (production) throw new Error('NEXT_PUBLIC_SITE_URL is not set. Set it to the public address of this deploy (docs/14).')
    return 'http://localhost:3000'
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`NEXT_PUBLIC_SITE_URL is not an absolute address: "${value}".`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`NEXT_PUBLIC_SITE_URL must start with https:// (read "${value}").`)
  }
  if (production && LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`NEXT_PUBLIC_SITE_URL points at ${url.hostname} in a production build; set the public address (docs/14).`)
  }
  return url.origin
}

export function isTruthyFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? '').trim())
}

export function siteConfig(env: SiteEnv = readEnv()): SiteConfig {
  const production = env.NODE_ENV === 'production'
  return {
    url: normalizeSiteUrl(env.NEXT_PUBLIC_SITE_URL, production),
    name: (env.NEXT_PUBLIC_SITE_NAME ?? '').trim() || 'Acme',
    description: (env.NEXT_PUBLIC_SITE_DESCRIPTION ?? '').trim(),
    noindex: isTruthyFlag(env.NEXT_PUBLIC_NOINDEX),
  }
}

/** A site path for a post's slug. */
export function postPath(slug: string): string {
  return `${BLOG_BASE_PATH}/${encodeURIComponent(slug)}`
}

/**
 * The absolute, canonical address of a path on this site: one origin, no query
 * string or fragment, no trailing slash except on the home page.
 */
export function canonicalUrl(path: string, site: Pick<SiteConfig, 'url'>): string {
  const clean = (path || '/').split(/[?#]/)[0]
  const withSlash = clean.startsWith('/') ? clean : `/${clean}`
  const trimmed = withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash
  return `${site.url}${trimmed || '/'}`
}

/**
 * An absolute address for a link or image that may be stored as a site path.
 * Addresses on another host are kept as they are; anything that is not http(s)
 * or a site path is dropped (returns null), so a stored `javascript:` value can
 * never reach a meta tag or schema.
 */
export function absoluteUrl(value: string | null | undefined, site: Pick<SiteConfig, 'url'>): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  if (v.startsWith('/') && !v.startsWith('//')) return `${site.url}${v}`
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

/** The fields the public site needs to decide whether a post is live. */
export type PostVisibility = {
  status: string | null | undefined
  publishedAt?: string | null
  unpublishAt?: string | null
}

/**
 * Whether a post is live right now: the same rule as the public read policy
 * (migration 003): published, or scheduled with its date passed, and not past
 * its end date. The sitemap and llms.txt apply it again on top of RLS, so a
 * draft never reaches them even if a query is widened later.
 */
export function isPublicPost(post: PostVisibility, now: Date = new Date()): boolean {
  const at = (s: string | null | undefined) => (s ? Date.parse(s) : NaN)
  const t = now.getTime()
  const started =
    post.status === 'published' ||
    (post.status === 'scheduled' && !Number.isNaN(at(post.publishedAt)) && at(post.publishedAt) <= t)
  if (!started) return false
  const end = at(post.unpublishAt)
  return Number.isNaN(end) || end > t
}
