// /robots.txt. NEXT_PUBLIC_NOINDEX=1 turns the whole site away (staging and
// preview deploys); otherwise the admin and the API are kept out and the
// sitemap is named. Rules: lib/seo/sitemap.ts; model: docs/14.
import type { MetadataRoute } from 'next'
import { siteConfig } from '@/lib/seo/site'
import { buildRobots } from '@/lib/seo/sitemap'

export default function robots(): MetadataRoute.Robots {
  return buildRobots(siteConfig())
}
