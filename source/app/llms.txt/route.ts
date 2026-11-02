// /llms.txt (llmstxt.org): a short Markdown map of the site for language-model
// readers, from the page registry and the live posts. Rules:
// lib/seo/sitemap.ts; model: docs/14.
import { getBlogPosts } from '@/lib/data'
import { PUBLIC_ROUTES } from '@/lib/seo/routes'
import { siteConfig } from '@/lib/seo/site'
import { buildLlmsTxt } from '@/lib/seo/sitemap'

export const revalidate = 3600

export async function GET() {
  const site = siteConfig()
  if (site.noindex) {
    return new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  const posts = await getBlogPosts()
  const body = buildLlmsTxt({
    site,
    routes: PUBLIC_ROUTES,
    posts: posts.map((p) => ({
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      status: p.status,
      publishedAt: p.publishedAt,
      unpublishAt: p.unpublishAt,
    })),
  })
  return new Response(body, { headers: { 'content-type': 'text/markdown; charset=utf-8' } })
}
