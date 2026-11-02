/**
 * Structured data (schema.org JSON-LD) for the public site, from typed
 * builders. The rule: the schema says only what the page shows. A field the
 * post does not have (an author, an image, a date) is left out, never filled
 * with a guess.
 */
import { postDescription, type SeoPost } from './metadata'
import { absoluteUrl, canonicalUrl, postPath, type SiteConfig } from './site'

type JsonLd = Record<string, unknown>

const CONTEXT = 'https://schema.org'

export function organizationId(site: Pick<SiteConfig, 'url'>): string {
  return `${site.url}/#organization`
}

export function websiteId(site: Pick<SiteConfig, 'url'>): string {
  return `${site.url}/#website`
}

/** Site-wide: put it in the root layout, once. */
export function organizationJsonLd(site: SiteConfig, opts: { logo?: string; sameAs?: string[] } = {}): JsonLd {
  const logo = absoluteUrl(opts.logo, site)
  const sameAs = (opts.sameAs ?? []).map((u) => absoluteUrl(u, site)).filter((u): u is string => !!u)
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    '@id': organizationId(site),
    name: site.name,
    url: canonicalUrl('/', site),
    ...(logo ? { logo } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  }
}

/** Site-wide: put it in the root layout, once. */
export function websiteJsonLd(site: SiteConfig): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    '@id': websiteId(site),
    name: site.name,
    url: canonicalUrl('/', site),
    ...(site.description ? { description: site.description } : {}),
    publisher: { '@id': organizationId(site) },
  }
}

export function breadcrumbJsonLd(items: { name: string; path: string }[], site: SiteConfig): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: canonicalUrl(item.path, site),
    })),
  }
}

export function blogPostingJsonLd(post: SeoPost, site: SiteConfig): JsonLd {
  const url = canonicalUrl(postPath(post.slug), site)
  const image = absoluteUrl(post.featuredImage, site)
  const description = postDescription(post)
  const authorUrl = absoluteUrl(post.author?.personalSiteUrl || post.author?.linkedinUrl, site)
  return {
    '@context': CONTEXT,
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    headline: post.title,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    ...(description ? { description } : {}),
    ...(image ? { image: [image] } : {}),
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    ...(post.updatedAt || post.publishedAt ? { dateModified: post.updatedAt || post.publishedAt } : {}),
    ...(post.categories?.length ? { articleSection: post.categories[0], keywords: post.categories.join(', ') } : {}),
    ...(post.author?.name
      ? { author: { '@type': 'Person', name: post.author.name, ...(authorUrl ? { url: authorUrl } : {}) } }
      : {}),
    publisher: { '@type': 'Organization', '@id': organizationId(site), name: site.name },
    isPartOf: { '@id': websiteId(site) },
  }
}

/**
 * The text of a `<script type="application/ld+json">` element. JSON.stringify
 * alone is not safe inside a script element: a post title containing
 * `</script>` would end it and run what follows. Escaping `<`, `>` and `&`
 * (and the two line separators JavaScript treats as newlines) keeps the JSON
 * identical when parsed and makes the element impossible to close early.
 */
export function jsonLdScriptContent(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029')
}
