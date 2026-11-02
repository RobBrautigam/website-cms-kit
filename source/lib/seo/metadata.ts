/**
 * Per-page metadata for the public site, built from a post's own fields.
 *
 * Two traps this builder exists to avoid:
 *   - Next.js replaces a parent's nested `openGraph` (and `twitter`) object
 *     wholesale. A layout-level share image silently disappears from every page
 *     that sets its own `openGraph`, so the image is named here, on the page,
 *     every time.
 *   - Without `metadataBase`, relative image addresses resolve against the
 *     build machine. The builder sets it from the site address and makes every
 *     image address absolute itself.
 */
import type { Metadata } from 'next'
import { clip, SEARCH_DESCRIPTION_MAX, SEARCH_TITLE_MAX } from '../admin/previews'
import { absoluteUrl, canonicalUrl, postPath, type SiteConfig } from './site'

/** The post fields the public pages read (the shape `mapPost()` returns). */
export type SeoPost = {
  title: string
  slug: string
  excerpt?: string | null
  metaDescription?: string | null
  featuredImage?: string | null
  featuredImageAlt?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
  categories?: string[] | null
  author?: { name: string; personalSiteUrl?: string | null; linkedinUrl?: string | null } | null
}

/**
 * The title tag: "Post title | Brand" when that fits in 60 characters, the
 * post title alone when it does not (search results cut at about 60, and the
 * brand is the part to lose).
 */
export function pageTitle(title: string, siteName: string): string {
  const t = (title ?? '').trim().replace(/\s+/g, ' ')
  const brand = (siteName ?? '').trim()
  if (!t) return brand
  if (!brand || t === brand) return t
  const withBrand = `${t} | ${brand}`
  return withBrand.length <= SEARCH_TITLE_MAX ? withBrand : t
}

/** The meta description: the post's own, else its excerpt, clipped to 160. */
export function postDescription(post: Pick<SeoPost, 'metaDescription' | 'excerpt'>): string {
  const d = (post.metaDescription || post.excerpt || '').trim()
  return d ? clip(d, SEARCH_DESCRIPTION_MAX) : ''
}

export function postMetadata(post: SeoPost, site: SiteConfig, opts: { preview?: boolean } = {}): Metadata {
  const url = canonicalUrl(postPath(post.slug), site)
  const title = pageTitle(post.title, site.name)
  const description = postDescription(post) || undefined
  const image = absoluteUrl(post.featuredImage, site)
  const imageAlt = (post.featuredImageAlt ?? '').trim() || undefined
  const noindex = site.noindex || opts.preview === true

  return {
    metadataBase: new URL(site.url),
    // `absolute` so a layout's title template cannot add the brand twice.
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      type: 'article',
      url,
      siteName: site.name,
      title: post.title,
      description,
      publishedTime: post.publishedAt || undefined,
      modifiedTime: post.updatedAt || post.publishedAt || undefined,
      section: post.categories?.[0] || undefined,
      images: image ? [{ url: image, alt: imageAlt }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: post.title,
      description,
      images: image ? [image] : undefined,
    },
  }
}
