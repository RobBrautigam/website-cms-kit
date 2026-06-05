// Trimmed extract: only the blog/posts data helpers the admin CMS uses.
// The original also served public marketing/funnel pages (team, case studies,
// static testimonials, lead/calendar helpers). Those are omitted here.
//
// Author resolution originally pulled from a static `../data/team` module.
// That module is site-specific (real team members) and is dropped in this kit.
// The Author type and resolveAuthor stub are retained so mapPost compiles;
// wire up your own team data source or remove author resolution entirely.

import { createAnonServerClient } from './supabase/server'
import type { BlogPost } from './supabase/types'

// ─── Author helper ───────────────────────────────────────────
// Replace this stub with your own team data source if needed.

export type Author = {
  slug: string
  name: string
  role: string
  photoUrl?: string | null
  linkedinUrl?: string | null
  personalSiteUrl?: string | null
  bio: string
}

/**
 * Resolve a blog-post author from your own team data.
 * `author_slug` is a TEXT slug (NOT a foreign key). The reference
 * implementation resolved against a static team array; replace this
 * with whatever source your project uses, or return null to omit authors.
 */
function resolveAuthor(_slug: string | null | undefined): Author | null {
  // Stub: no team data in this kit. Return null or wire your own source.
  return null
}

// ─── Helpers ────────────────────────────────────────────────

function mapPost(row: BlogPost) {
  const author = resolveAuthor(row.author_slug)
  return {
    _id: row.id,
    title: row.title,
    slug: row.slug,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    excerpt: row.excerpt,
    featuredImage: row.featured_image_url,
    featuredImageAlt: row.featured_image_alt,
    categories: row.categories,
    status: row.status,
    metaDescription: row.meta_description,
    body: row.body,
    author,
  }
}

// ─── Blog (Supabase) ────────────────────────────────────────

export async function getBlogPosts() {
  try {
    const supabase = createAnonServerClient()
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('blog_posts')
      .select('*')
      .or(`status.eq.published,and(status.eq.scheduled,published_at.lte.${now})`)
      .order('published_at', { ascending: false })

    if (error) throw error
    return (data as BlogPost[]).map(mapPost)
  } catch (e) {
    console.error('Failed to fetch blog posts:', e)
    return []
  }
}

export async function getBlogPost(slug: string) {
  try {
    const supabase = createAnonServerClient()
    const { data, error } = await supabase
      .from('blog_posts')
      .select('*')
      .eq('slug', slug)
      .single()

    if (error) throw error
    return mapPost(data as BlogPost)
  } catch (e) {
    console.error('Failed to fetch blog post:', e)
    return null
  }
}

export async function getBlogSlugs(): Promise<string[]> {
  try {
    const supabase = createAnonServerClient()
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('blog_posts')
      .select('slug')
      .or(`status.eq.published,and(status.eq.scheduled,published_at.lte.${now})`)

    if (error) throw error
    return (data || []).map((row: { slug: string }) => row.slug)
  } catch (e) {
    console.error('Failed to fetch blog slugs:', e)
    return []
  }
}

/**
 * Minimal blog data for the sitemap: `slug` + `featured_image_url` only.
 * Deliberately narrow (NOT `select('*')`) so crawler hits — which can fire
 * every revalidate window — never pull full post bodies just to emit URLs +
 * image entries. Throws on error so the sitemap's own try/catch can fall back
 * to a slug-only path (the wrapper that swallows errors must not be used here).
 */
export async function getBlogSitemapEntries(): Promise<
  Array<{ slug: string; featuredImage: string | null }>
> {
  const supabase = createAnonServerClient()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('blog_posts')
    .select('slug,featured_image_url')
    .or(`status.eq.published,and(status.eq.scheduled,published_at.lte.${now})`)

  if (error) throw error
  return (data || []).map(
    (row: { slug: string; featured_image_url: string | null }) => ({
      slug: row.slug,
      featuredImage: row.featured_image_url,
    }),
  )
}

/**
 * Returns up to `limit` related posts for use on the blog detail page.
 * Selection is deterministic and SQL-driven:
 *   1. Posts that share at least one category with the current post,
 *      ordered by publishedAt DESC.
 *   2. If fewer than `limit` matched, fill from most-recent overall.
 *   3. Always excludes the current slug.
 */
export async function getRelatedPosts(
  currentSlug: string,
  categories: string[] | null | undefined,
  limit = 3,
) {
  const supabase = createAnonServerClient()
  const now = new Date().toISOString()
  let related: ReturnType<typeof mapPost>[] = []

  if (categories && categories.length > 0) {
    const { data, error } = await supabase
      .from('blog_posts')
      .select('*')
      .or(`status.eq.published,and(status.eq.scheduled,published_at.lte.${now})`)
      .overlaps('categories', categories)
      .neq('slug', currentSlug)
      .order('published_at', { ascending: false })
      .limit(limit)
    if (!error && data) {
      related = (data as BlogPost[]).map(mapPost)
    }
  }

  if (related.length < limit) {
    const seen = new Set([currentSlug, ...related.map((p) => p.slug)])
    const { data, error } = await supabase
      .from('blog_posts')
      .select('*')
      .or(`status.eq.published,and(status.eq.scheduled,published_at.lte.${now})`)
      .order('published_at', { ascending: false })
      .limit(limit + seen.size)
    if (!error && data) {
      const fill = (data as BlogPost[])
        .map(mapPost)
        .filter((p) => !seen.has(p.slug))
        .slice(0, limit - related.length)
      related = related.concat(fill)
    }
  }

  return related
}
