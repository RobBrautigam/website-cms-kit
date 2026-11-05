// /llms.txt (llmstxt.org): a short Markdown map of the site for language-model
// readers, from the page registry and the live posts. Rules:
// lib/seo/sitemap.ts; model: docs/14.
//
// The posts come from a narrow read that throws on a database error, and this
// route does not catch it: Next.js keeps serving the last good file when a
// regeneration fails, where a caught error would cache a map with no posts for
// the whole revalidate window. A build that cannot reach the database fails
// here, which says so at deploy time rather than an hour later.
import { getLlmsTxtEntries } from '@/lib/data'
import { PUBLIC_ROUTES } from '@/lib/seo/routes'
import { siteConfig } from '@/lib/seo/site'
import { buildLlmsTxt } from '@/lib/seo/sitemap'

export const revalidate = 3600

export async function GET() {
  const site = siteConfig()
  if (site.noindex) {
    return new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  const posts = await getLlmsTxtEntries()
  const body = buildLlmsTxt({ site, routes: PUBLIC_ROUTES, posts })
  return new Response(body, { headers: { 'content-type': 'text/markdown; charset=utf-8' } })
}
