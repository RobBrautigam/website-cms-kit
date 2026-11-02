/**
 * The public site's page registry: one list read by `app/sitemap.ts`,
 * `app/llms.txt/route.ts` and the admin's Sitemap screen, so the three cannot
 * drift apart. Add every public page you build here; posts are added from the
 * database on their own.
 */
import type { PublicRoute } from './sitemap'

export const PUBLIC_ROUTES: PublicRoute[] = [
  { path: '/', title: 'Home', changeFrequency: 'weekly', priority: 1 },
  { path: '/blog', title: 'Blog', changeFrequency: 'daily', priority: 0.8 },
  { path: '/about', title: 'About', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/careers', title: 'Careers', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/privacy', title: 'Privacy Policy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', title: 'Terms of Service', changeFrequency: 'yearly', priority: 0.2 },
]
