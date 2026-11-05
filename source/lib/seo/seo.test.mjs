// The public SEO spine (docs/14): the site address, per-post metadata, the
// structured data, the sitemap, robots.txt and llms.txt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { absoluteUrl, canonicalUrl, isPublicPost, normalizeSiteUrl, postPath, siteConfig } from './site.ts'
import { pageTitle, postDescription, postMetadata } from './metadata.ts'
import { blogPostingJsonLd, breadcrumbJsonLd, jsonLdScriptContent, organizationJsonLd, websiteJsonLd } from './json-ld.ts'
import { buildLlmsTxt, buildRobots, buildSitemap } from './sitemap.ts'
import { PUBLIC_ROUTES } from './routes.ts'

const site = { url: 'https://www.example.com', name: 'Acme', description: 'Notes from a small garden studio.', noindex: false }
const NOW = new Date('2026-06-01T12:00:00Z')
const post = {
  title: 'How we plan a dry garden',
  slug: 'dry-garden',
  excerpt: 'Plants that survive a summer without daily watering.',
  metaDescription: '',
  featuredImage: '/storage/v1/object/public/blog-images/blog/abcdef12.png',
  featuredImageAlt: 'A gravel bed of lavender',
  publishedAt: '2026-05-01T09:00:00Z',
  updatedAt: '2026-05-03T10:00:00Z',
  categories: ['Gardens'],
  author: null,
}

test('site address: production refuses a missing or local address, development falls back to localhost', () => {
  assert.throws(() => normalizeSiteUrl('', true), /NEXT_PUBLIC_SITE_URL is not set/)
  assert.throws(() => normalizeSiteUrl('http://localhost:3000', true), /points at localhost/)
  assert.throws(() => normalizeSiteUrl('http://127.0.0.1:3000', true), /points at 127\.0\.0\.1/)
  assert.throws(() => normalizeSiteUrl('ftp://example.com', true), /must start with https/)
  assert.throws(() => normalizeSiteUrl('example.com', true), /not an absolute address/)
  assert.equal(normalizeSiteUrl('', false), 'http://localhost:3000')
  assert.equal(normalizeSiteUrl('https://www.example.com/blog/', true), 'https://www.example.com')
  const cfg = siteConfig({ NEXT_PUBLIC_SITE_URL: 'https://www.example.com/', NEXT_PUBLIC_NOINDEX: 'true', NODE_ENV: 'production' })
  assert.deepEqual(cfg, { url: 'https://www.example.com', name: 'Acme', description: '', noindex: true })
  assert.equal(siteConfig({ NEXT_PUBLIC_SITE_URL: 'https://x.example', NEXT_PUBLIC_NOINDEX: '0' }).noindex, false)
})

test('canonical and absolute addresses: one origin, no query, no trailing slash; unsafe values dropped', () => {
  assert.equal(canonicalUrl('/', site), 'https://www.example.com/')
  assert.equal(canonicalUrl('/blog/dry-garden/?utm_source=x#top', site), 'https://www.example.com/blog/dry-garden')
  assert.equal(canonicalUrl('blog', site), 'https://www.example.com/blog')
  assert.equal(postPath('dry-garden'), '/blog/dry-garden')
  assert.equal(absoluteUrl('/a.png', site), 'https://www.example.com/a.png')
  assert.equal(absoluteUrl('https://cdn.example.net/a.png', site), 'https://cdn.example.net/a.png')
  assert.equal(absoluteUrl('//evil.example/a.png', site), null)
  assert.equal(absoluteUrl('javascript:alert(1)', site), null)
  assert.equal(absoluteUrl('', site), null)
})

test('a live post is the public read policy: published, or scheduled and due, and before its end date', () => {
  assert.equal(isPublicPost({ status: 'published' }, NOW), true)
  assert.equal(isPublicPost({ status: 'draft', publishedAt: '2026-01-01T00:00:00Z' }, NOW), false)
  assert.equal(isPublicPost({ status: 'scheduled', publishedAt: '2026-07-01T00:00:00Z' }, NOW), false)
  assert.equal(isPublicPost({ status: 'scheduled', publishedAt: '2026-05-01T00:00:00Z' }, NOW), true)
  assert.equal(isPublicPost({ status: 'scheduled', publishedAt: null }, NOW), false)
  assert.equal(isPublicPost({ status: 'published', unpublishAt: '2026-05-31T00:00:00Z' }, NOW), false)
  assert.equal(isPublicPost({ status: 'published', unpublishAt: '2026-06-02T00:00:00Z' }, NOW), true)
})

test('title tag: the brand is added only when the whole fits in 60 characters', () => {
  assert.equal(pageTitle('How we plan a dry garden', 'Acme'), 'How we plan a dry garden | Acme')
  const fits = 'Planning a garden that survives a long, dry summer'
  assert.equal(pageTitle(fits, 'Acme'), `${fits} | Acme`)
  const long = 'Planning a garden that survives a long, dry, hot summer'
  assert.ok(long.length <= 60 && `${long} | Acme`.length > 60)
  assert.equal(pageTitle(long, 'Acme'), long)
  assert.equal(pageTitle('  ', 'Acme'), 'Acme')
  assert.equal(postDescription({ metaDescription: '', excerpt: 'Short.' }), 'Short.')
  assert.ok(postDescription({ metaDescription: 'x '.repeat(120) }).length <= 160)
})

test('post metadata: metadataBase, an absolute canonical, and the share image named on the page itself', () => {
  const m = postMetadata(post, site)
  assert.equal(m.metadataBase.href, 'https://www.example.com/')
  assert.deepEqual(m.title, { absolute: 'How we plan a dry garden | Acme' })
  assert.equal(m.alternates.canonical, 'https://www.example.com/blog/dry-garden')
  assert.equal(m.description, post.excerpt)
  assert.equal(m.robots, undefined)
  const img = 'https://www.example.com/storage/v1/object/public/blog-images/blog/abcdef12.png'
  assert.deepEqual(m.openGraph.images, [{ url: img, alt: 'A gravel bed of lavender' }])
  assert.equal(m.openGraph.url, 'https://www.example.com/blog/dry-garden')
  assert.equal(m.openGraph.publishedTime, post.publishedAt)
  assert.equal(m.openGraph.modifiedTime, post.updatedAt)
  assert.deepEqual(m.twitter.images, [img])
  assert.equal(m.twitter.card, 'summary_large_image')
})

test('post metadata: no image means no image tags and a small card; the switch and a preview both mean noindex', () => {
  const m = postMetadata({ ...post, featuredImage: null }, site)
  assert.equal(m.openGraph.images, undefined)
  assert.equal(m.twitter.images, undefined)
  assert.equal(m.twitter.card, 'summary')
  assert.deepEqual(postMetadata(post, { ...site, noindex: true }).robots, { index: false, follow: false })
  assert.deepEqual(postMetadata(post, site, { preview: true }).robots, { index: false, follow: false })
})

test('BlogPosting says only what the post has: no author, image or date is invented', () => {
  const bare = blogPostingJsonLd({ title: 'T', slug: 's' }, site)
  for (const key of ['author', 'image', 'datePublished', 'dateModified', 'description', 'articleSection']) {
    assert.equal(key in bare, false, `${key} should be absent`)
  }
  assert.equal(bare['@type'], 'BlogPosting')
  assert.equal(bare.url, 'https://www.example.com/blog/s')
  assert.deepEqual(bare.publisher, { '@type': 'Organization', '@id': 'https://www.example.com/#organization', name: 'Acme' })

  const full = blogPostingJsonLd({ ...post, author: { name: 'Sam Rivera', personalSiteUrl: 'https://sam.example.org' } }, site)
  assert.deepEqual(full.author, { '@type': 'Person', name: 'Sam Rivera', url: 'https://sam.example.org/' })
  assert.deepEqual(full.image, ['https://www.example.com/storage/v1/object/public/blog-images/blog/abcdef12.png'])
  assert.equal(full.datePublished, post.publishedAt)
  assert.equal(full.dateModified, post.updatedAt)
  assert.equal(full.articleSection, 'Gardens')
})

test('site-wide schema and breadcrumbs point at one organization and absolute addresses', () => {
  const org = organizationJsonLd(site, { logo: '/logo.png', sameAs: ['https://social.example/acme', 'javascript:x'] })
  assert.equal(org['@id'], 'https://www.example.com/#organization')
  assert.equal(org.logo, 'https://www.example.com/logo.png')
  assert.deepEqual(org.sameAs, ['https://social.example/acme'])
  assert.equal('logo' in organizationJsonLd(site), false)
  assert.equal(websiteJsonLd(site).publisher['@id'], org['@id'])
  const crumbs = breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }], site)
  assert.deepEqual(crumbs.itemListElement.map((i) => [i.position, i.item]), [[1, 'https://www.example.com/'], [2, 'https://www.example.com/blog']])
})

test('the JSON-LD script text cannot be closed early by a field, and parses back to the same data', () => {
  const data = { headline: 'Evil </script><script>alert(1)</script> & <!-- more', note: 'line\u2028sep' }
  const text = jsonLdScriptContent(data)
  assert.equal(/<\/?script/i.test(text), false)
  assert.equal(text.includes('<'), false)
  assert.equal(text.includes('&'), false)
  assert.equal(text.includes('\u2028'), false)
  assert.deepEqual(JSON.parse(text), data)
})

test('sitemap: registered pages and live posts only, with last change and image; empty under the noindex switch', () => {
  const posts = [
    { slug: 'dry-garden', status: 'published', featuredImage: '/a.png', updatedAt: '2026-05-03T10:00:00Z', publishedAt: '2026-05-01T09:00:00Z' },
    { slug: 'secret-draft', status: 'draft', publishedAt: '2026-05-01T09:00:00Z' },
    { slug: 'next-month', status: 'scheduled', publishedAt: '2026-07-01T09:00:00Z' },
    { slug: 'came-down', status: 'published', unpublishAt: '2026-05-20T00:00:00Z' },
    { slug: 'due-today', status: 'scheduled', publishedAt: '2026-06-01T08:00:00Z' },
  ]
  const routes = [...PUBLIC_ROUTES, { path: '/thank-you', title: 'Thanks', noindex: true }, { path: '/', title: 'Home again' }]
  const map = buildSitemap({ site, routes, posts, now: NOW })
  const urls = map.map((e) => e.url)
  assert.ok(urls.includes('https://www.example.com/'))
  assert.ok(urls.includes('https://www.example.com/blog/dry-garden'))
  assert.ok(urls.includes('https://www.example.com/blog/due-today'))
  for (const hidden of ['secret-draft', 'next-month', 'came-down', 'thank-you']) {
    assert.equal(urls.some((u) => u.includes(hidden)), false, `${hidden} must not be listed`)
  }
  assert.equal(urls.filter((u) => u === 'https://www.example.com/').length, 1)
  const entry = map.find((e) => e.url.endsWith('/dry-garden'))
  assert.equal(entry.lastModified, '2026-05-03T10:00:00Z')
  assert.deepEqual(entry.images, ['https://www.example.com/a.png'])
  assert.deepEqual(buildSitemap({ site: { ...site, noindex: true }, routes, posts, now: NOW }), [])
})

test('robots: the switch turns everything away; otherwise admin and API are kept out and the sitemap is absolute', () => {
  assert.deepEqual(buildRobots({ ...site, noindex: true }), { rules: [{ userAgent: '*', disallow: '/' }] })
  const r = buildRobots(site)
  assert.deepEqual(r.rules, [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] }])
  assert.equal(r.sitemap, 'https://www.example.com/sitemap.xml')
})

test('llms.txt: the name, the description, the pages and live posts; no contact line unless one is given', () => {
  const posts = [
    { slug: 'dry-garden', title: 'How we plan a dry garden', excerpt: 'Plants that\nlast.', status: 'published' },
    { slug: 'secret-draft', title: 'Not yet', status: 'draft' },
  ]
  const text = buildLlmsTxt({ site, routes: PUBLIC_ROUTES, posts, now: NOW })
  assert.match(text, /^# Acme\n\n> Notes from a small garden studio\.\n/)
  assert.match(text, /- \[How we plan a dry garden\]\(https:\/\/www\.example\.com\/blog\/dry-garden\): Plants that last\./)
  assert.equal(text.includes('secret-draft'), false)
  assert.equal(/contact/i.test(text), false)
  assert.match(buildLlmsTxt({ site, routes: [], posts: [], contact: 'hello@example.com' }), /## Contact\n\n- hello@example\.com/)
})
