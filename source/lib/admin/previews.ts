/**
 * How a post will look in a search result and in a social share card, from
 * the fields on the edit screen. The truncation lengths are approximations:
 * search engines cut titles by pixel width (about 60 characters) and
 * descriptions at about 155 to 160; share cards vary by network.
 */

export const SEARCH_TITLE_MAX = 60
export const SEARCH_DESCRIPTION_MAX = 160
export const SOCIAL_DESCRIPTION_MAX = 200

export type PreviewInput = {
  title: string
  slug: string
  excerpt?: string
  metaDescription?: string
  featuredImageUrl?: string
  featuredImageAlt?: string
  /** The public site's origin, e.g. https://www.example.com */
  siteUrl: string
  /** Where posts live on the site. */
  basePath?: string
}

export function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function host(siteUrl: string): string {
  try {
    return new URL(siteUrl).host
  } catch {
    return siteUrl
  }
}

export function searchPreview(p: PreviewInput) {
  const description = (p.metaDescription || p.excerpt || '').trim()
  const basePath = (p.basePath ?? '/blog').replace(/\/$/, '')
  const warnings: string[] = []
  if (!p.title.trim()) warnings.push('Add a title.')
  else if (p.title.trim().length > SEARCH_TITLE_MAX) warnings.push(`The title is ${p.title.trim().length} characters; search results show about ${SEARCH_TITLE_MAX}.`)
  if (!p.metaDescription?.trim()) warnings.push(p.excerpt?.trim() ? 'No meta description: search engines may use the excerpt or pick their own text.' : 'No meta description or excerpt: search engines will pick their own text.')
  else if (p.metaDescription.trim().length > SEARCH_DESCRIPTION_MAX) warnings.push(`The meta description is ${p.metaDescription.trim().length} characters; about ${SEARCH_DESCRIPTION_MAX} show.`)
  return {
    title: clip(p.title || 'Untitled post', SEARCH_TITLE_MAX),
    breadcrumb: [host(p.siteUrl), ...basePath.split('/').filter(Boolean), p.slug || 'your-slug'].join(' › '),
    description: description ? clip(description, SEARCH_DESCRIPTION_MAX) : '',
    warnings,
  }
}

export function socialPreview(p: PreviewInput) {
  const description = (p.excerpt || p.metaDescription || '').trim()
  return {
    domain: host(p.siteUrl).toUpperCase(),
    title: clip(p.title || 'Untitled post', 90),
    description: description ? clip(description, SOCIAL_DESCRIPTION_MAX) : '',
    image: p.featuredImageUrl?.trim() || null,
    imageAlt: p.featuredImageAlt?.trim() || '',
    warnings: p.featuredImageUrl?.trim() ? [] : ['No featured image: most networks show a text-only card.'],
  }
}
