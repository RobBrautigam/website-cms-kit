// The edit screen's content checks: one H1, no skipped heading levels, link
// text that names its page, alt text on every image and a clean slug.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SLUG_PATTERN, bodyHeadings, bodyLinks, contentChecks, linkTexts, slugify } from './content-checks.ts'
import { renderedHeadingLevel } from '../tiptap/schema.ts'

const doc = (...content) => ({ type: 'doc', content })
const text = (t, ...marks) => (marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t })
const p = (...content) => ({ type: 'paragraph', content })
const h = (level, t) => ({ type: 'heading', attrs: { level }, content: t ? [text(t)] : [] })
const link = (href) => ({ type: 'link', attrs: { href } })
const bold = { type: 'bold' }
const img = (alt) => ({ type: 'image', attrs: { src: 'https://x/a.png', alt } })

const clean = doc(
  p(text('A lede.')),
  h(2, 'Plan the beds'),
  p(text('See '), text('the watering guide', link('/blog/watering')), text('.')),
  h(3, 'Mulch'),
  img('Straw mulch around tomato plants'),
  h(2, 'Pick the plants'),
)

test('content checks: a clean post and a clean slug pass with no warnings', () => {
  assert.deepEqual(contentChecks({ body: clean, slug: 'dry-summer-garden' }), [])
})

test('content checks: the title is the one H1, so an H1 in the body is flagged', () => {
  const one = contentChecks({ body: doc(h(1, 'Again'), h(2, 'Next')), slug: 'ok' })
  assert.equal(one.length, 1)
  assert.match(one[0], /^The body has an H1 \("Again"\), shown as an H2 in the editor\./)
  const two = contentChecks({ body: doc(h(1, 'A'), h(1, 'B')), slug: 'ok' })
  assert.match(two[0], /^The body has 2 H1 headings \("A", "B"\), shown as H2 in the editor\./)
  const unnamed = contentChecks({ body: doc(h(1, '')), slug: 'ok' })
  assert.ok(unnamed.some((m) => m.startsWith('The body has an H1, shown as an H2')), unnamed.join(' | '))
})

test('content checks: an H3 with no H2 above it is a skipped level; going back up is fine', () => {
  const w = contentChecks({ body: doc(h(3, 'Too deep'), h(2, 'Back up'), h(3, 'Fine'), h(2, 'Up again')), slug: 'ok' })
  assert.equal(w.length, 1)
  assert.match(w[0], /The heading "Too deep" is drawn as an H3 with no H2 above it\. Headings are read as an outline; go down one level at a time\.$/)
  const many = contentChecks({ body: doc(h(3, 'One'), h(1, 'Reset'), h(3, 'Two')), slug: 'ok' })
  assert.ok(many.some((m) => /^2 headings are drawn as H3 with no H2 above them \("One", "Two"\)/.test(m)), many.join(' | '))
})

test('content checks: a stored H4 is drawn as an H3 and judged as one', () => {
  assert.equal(renderedHeadingLevel(4), 3)
  assert.equal(renderedHeadingLevel(undefined), 2)
  assert.equal(renderedHeadingLevel(1), 1)
  assert.deepEqual(bodyHeadings(doc(h(2, 'A'), h(4, 'B'))).map((x) => x.level), [2, 3])
  // The editor offers only H2 and H3 and shows any other stored level as an H2.
  assert.deepEqual(bodyHeadings(doc(h(1, 'A'), h(2, 'B'), h(3, 'C'), h(4, 'D'))).map((x) => x.inEditor), [2, 2, 3, 2])
  assert.deepEqual(contentChecks({ body: doc(h(2, 'A'), h(4, 'B')), slug: 'ok' }), [])
  const deep = contentChecks({ body: doc(h(4, 'Deep')), slug: 'ok' })[0]
  assert.match(deep, /"Deep" is drawn as an H3 with no H2/)
  assert.match(deep, /The editor shows a heading stored deeper than H3 as an H2; press H3 on it to set its level\.$/)
})

test('content checks: the renderer draws headings through the same level function', () => {
  const renderer = readFileSync(new URL('../../components/TipTapRenderer.tsx', import.meta.url), 'utf8')
  assert.match(renderer, /const level = renderedHeadingLevel\(node\.attrs\?\.level\)/)
})

test('content checks: an empty heading is flagged', () => {
  const w = contentChecks({ body: doc(h(2, ''), h(2, '  ')), slug: 'ok' })
  assert.deepEqual(w, ['2 headings have no text.'])
})

test('content checks: link text is read whole across marks, and vague or bare-address text is flagged', () => {
  assert.deepEqual(linkTexts(doc(p(text('read ', link('/a')), text('more', link('/a'), bold), text(' and '), text('more', link('/b'))))), ['read more', 'more'])
  // The same address after plain text in between is a second link.
  assert.deepEqual(linkTexts(doc(p(text('one', link('/a')), text(' '), text('two', link('/a'))))), ['one', 'two'])
  const w = contentChecks({
    body: doc(p(text('Click here', link('/a')), text(' or '), text('Read more »', link('/b')), text(' or '), text('https://example.com/x', link('https://example.com/x')))),
    slug: 'ok',
  })
  assert.equal(w.length, 2, w.join(' | '))
  assert.match(w[0], /^2 links say "Click here", "Read more »"\./)
  assert.match(w[1], /^1 link shows a bare address as its text\./)
  assert.deepEqual(contentChecks({ body: doc(p(text('  ', link('/a')))), slug: 'ok' }), ['1 link has no text.'])
  assert.deepEqual(contentChecks({ body: doc(p(text('Here is the guide to mulch', link('/a')))), slug: 'ok' }), [])
})

test('content checks: vague text is found inside leading and enclosing punctuation, one link named alone', () => {
  for (const t of ['→ Read more', '(read more)', '"here"', '« Continue reading »']) {
    const w = contentChecks({ body: doc(p(text(t, link('/a')))), slug: 'ok' })
    assert.equal(w.length, 1, `${t}: ${w.join(' | ')}`)
    assert.ok(w[0].startsWith(`1 link says "${t}".`), w[0])
  }
})

test('content checks: a link whose text is its own address is a bare address, with or without the scheme', () => {
  const bare = (t, href) => contentChecks({ body: doc(p(text(t, link(href)))), slug: 'ok' })
  assert.deepEqual(bare('example.com/page', 'https://example.com/page'), ['1 link shows a bare address as its text. Name the page it goes to instead.'])
  assert.deepEqual(bare('www.example.com', 'https://example.com/'), ['1 link shows a bare address as its text. Name the page it goes to instead.'])
  assert.deepEqual(bare('/blog/watering', '/blog/watering'), ['1 link shows a bare address as its text. Name the page it goes to instead.'])
  // The address's www. is dropped before comparing; any text starting http(s):// or www. reads as an address.
  assert.deepEqual(bare('example.com/page', 'https://www.example.com/page'), ['1 link shows a bare address as its text. Name the page it goes to instead.'])
  assert.deepEqual(bare('https://example.com', '/about'), ['1 link shows a bare address as its text. Name the page it goes to instead.'])
  // A product name with a dot is not an address.
  assert.deepEqual(bare('Node.js', 'https://nodejs.org/'), [])
  assert.equal(bodyLinks(doc(p(text('Node.js', link('https://nodejs.org/')))))[0].href, 'https://nodejs.org/')
})

test('content checks: images without alt text are counted, nested ones too', () => {
  const w = contentChecks({ body: doc(img(''), { type: 'blockquote', content: [img(undefined)] }, img('A chart')), slug: 'ok' })
  assert.deepEqual(w, ['2 images in the post have no alt text; it is needed before the post goes live.'])
  assert.deepEqual(contentChecks({ body: doc(img('  ')), slug: 'ok' }), ['1 image in the post has no alt text; it is needed before the post goes live.'])
})

test('content checks: the editor makes a slug that passes, even from a long title', () => {
  assert.equal(slugify('  How to Plan a Dry Garden!  '), 'how-to-plan-a-dry-garden')
  const long = slugify(`${'a'.repeat(95)} b`)
  assert.equal(long, 'a'.repeat(95))
  assert.ok(SLUG_PATTERN.test(long))
  assert.ok(slugify('x'.repeat(200)).length <= 96)
  const sidebar = readFileSync(new URL('../../components/admin/PostMetaSidebar.tsx', import.meta.url), 'utf8')
  assert.match(sidebar, /import \{ contentChecks, slugify \} from '@\/lib\/admin\/content-checks'/)
  assert.equal(/function slugify/.test(sidebar), false, 'one slugify, in the lib')
})

test('content checks: the slug is lowercase letters and digits joined by single hyphens', () => {
  for (const ok of ['a', 'dry-garden', '2026-plan', 'a1-b2']) assert.ok(SLUG_PATTERN.test(ok), ok)
  for (const bad of ['Dry-Garden', 'dry--garden', '-dry', 'dry-', 'dry_garden', 'dry garden', 'café']) assert.equal(SLUG_PATTERN.test(bad), false, bad)
  assert.match(contentChecks({ body: doc(), slug: 'Dry_Garden' })[0], /^The slug should be lowercase letters and digits/)
  assert.match(contentChecks({ body: doc(), slug: '  ' })[0], /^Add a slug/)
  assert.match(contentChecks({ body: doc(), slug: null })[0], /^Add a slug/)
})

test('content checks: an empty or malformed body gives no body warnings', () => {
  for (const body of [undefined, null, {}, doc(), 'not json', { type: 'doc', content: 'x' }]) {
    assert.deepEqual(contentChecks({ body, slug: 'ok' }), [], String(body))
  }
})
