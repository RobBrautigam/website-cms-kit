// The edit screen's comforts: alt text, previews, autosave, bulk actions and
// the admin theme.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { altTextRefusal, bodyImagesMissingAlt } from './alt-text.ts'
import { searchPreview, socialPreview, clip } from './previews.ts'
import { AUTOSAVE_DELAY_MS, autosaveLabel, autosaveTarget, isDirty, snapshot } from './autosave.ts'
import { MAX_BULK, bulkSummary, isBulkAction, planBulk } from './bulk.ts'
import { THEME_COOKIE, nextTheme, parseTheme, themeCookie } from './theme.ts'

const img = (alt) => ({ type: 'image', attrs: { src: 'https://x/storage/v1/object/public/blog-images/blog/abcdef12.png', alt } })
const doc = (...content) => ({ type: 'doc', content })

test('alt text: every body image is counted, nested ones too', () => {
  assert.equal(bodyImagesMissingAlt(doc(img('A chart'), img(''), img('  '), { type: 'blockquote', content: [img(undefined)] })), 3)
  assert.equal(bodyImagesMissingAlt(doc(img('ok'))), 0)
  assert.equal(bodyImagesMissingAlt(null), 0)
})

test('alt text: going live is refused until the featured image and every body image have it', () => {
  assert.equal(altTextRefusal({ featuredImageUrl: '', featuredImageAlt: '', body: doc() }), null)
  assert.equal(altTextRefusal({ featuredImageUrl: 'https://x/a.png', featuredImageAlt: 'A dog', body: doc(img('A cat')) }), null)
  assert.match(altTextRefusal({ featuredImageUrl: 'https://x/a.png', featuredImageAlt: ' ', body: doc() }), /the featured image\./)
  assert.match(altTextRefusal({ featuredImageUrl: null, body: doc(img(''), img('')) }), /2 images in the post/)
  assert.match(altTextRefusal({ featuredImageUrl: 'u', featuredImageAlt: '', body: doc(img('')) }), /the featured image and 1 image in the post/)
})

test('search preview: clipped title, breadcrumb, description falls back to the excerpt, with warnings', () => {
  const p = searchPreview({ title: 'How to plan a garden that survives a dry summer without daily watering', slug: 'dry-garden', excerpt: 'Short excerpt.', siteUrl: 'https://www.example.com' })
  assert.ok(p.title.length <= 60 && p.title.endsWith('…'))
  assert.equal(p.breadcrumb, 'www.example.com › blog › dry-garden')
  assert.equal(p.description, 'Short excerpt.')
  assert.equal(p.warnings.length, 2)
  const ok = searchPreview({ title: 'Dry gardens', slug: 'dry', metaDescription: 'Plan it once.', siteUrl: 'https://www.example.com', basePath: '/notes/' })
  assert.deepEqual(ok.warnings, [])
  assert.equal(ok.breadcrumb, 'www.example.com › notes › dry')
})

test('social preview: domain, image and a warning when there is no image', () => {
  const s = socialPreview({ title: 'Dry gardens', slug: 'dry', excerpt: 'Plan once.', siteUrl: 'https://www.example.com' })
  assert.equal(s.domain, 'WWW.EXAMPLE.COM')
  assert.equal(s.image, null)
  assert.equal(s.warnings.length, 1)
  const withImage = socialPreview({ title: 'T', slug: 's', featuredImageUrl: 'https://x/a.png', featuredImageAlt: 'A', siteUrl: 'https://e.com' })
  assert.equal(withImage.image, 'https://x/a.png')
  assert.deepEqual(withImage.warnings, [])
  assert.equal(clip('a b c', 10), 'a b c')
})

test('autosave goes to the draft row, the staged copy of a live post, or this browser for a new post', () => {
  assert.equal(autosaveTarget({ postId: null, isLive: false }), 'browser')
  assert.equal(autosaveTarget({ postId: 'p', isLive: false }), 'draft')
  assert.equal(autosaveTarget({ postId: 'p', isLive: true }), 'staged')
  assert.equal(autosaveTarget({ postId: 'p', isLive: true, stagedReviewStatus: 'staged' }), 'staged')
  assert.equal(autosaveTarget({ postId: 'p', isLive: true, stagedReviewStatus: 'in_review' }), 'paused')
  assert.equal(autosaveTarget({ postId: 'p', isLive: true, stagedReviewStatus: 'approved' }), 'paused')
  assert.ok(AUTOSAVE_DELAY_MS >= 1000 && AUTOSAVE_DELAY_MS <= 10000)
})

test('a draft with a staged copy autosaves to the staged copy, and a scheduled post is never autosaved', () => {
  // The editor opens on the staged copy, so writing the draft row would be
  // lost when the staged copy is published (review finding 1).
  assert.equal(autosaveTarget({ postId: 'p', isLive: false, stagedReviewStatus: 'staged' }), 'staged')
  assert.equal(autosaveTarget({ postId: 'p', isLive: false, stagedReviewStatus: 'in_review' }), 'paused')
  assert.equal(autosaveTarget({ postId: 'p', isLive: false, stagedReviewStatus: 'approved' }), 'paused')
  // A scheduled post goes live on its own: half-typed text must not (finding 2).
  assert.equal(autosaveTarget({ postId: 'p', isLive: false, isScheduled: true }), 'off')
  assert.equal(autosaveTarget({ postId: 'p', isLive: false, isScheduled: true, stagedReviewStatus: 'staged' }), 'staged')
  assert.match(autosaveLabel({ target: 'off', dirty: true, saving: false, savedAt: null, error: null }), /scheduled post saves when you press Update/)
})

test('unsaved changes are content changes, not key order', () => {
  const saved = snapshot({ title: 'A', body: { type: 'doc', content: [] } })
  assert.equal(isDirty(saved, { body: { content: [], type: 'doc' }, title: 'A' }), false)
  assert.equal(isDirty(saved, { title: 'B', body: { type: 'doc', content: [] } }), true)
})

test('the autosave label says where the work is', () => {
  const base = { dirty: false, saving: false, savedAt: null, error: null }
  assert.equal(autosaveLabel({ ...base, target: 'draft', saving: true }), 'Saving…')
  assert.equal(autosaveLabel({ ...base, target: 'draft', error: 'offline' }), 'Not saved: offline')
  assert.equal(autosaveLabel({ ...base, target: 'browser', dirty: true }), 'Unsaved (kept in this browser)')
  assert.match(autosaveLabel({ ...base, target: 'paused', dirty: true }), /paused while this change is in review/)
  assert.match(autosaveLabel({ ...base, target: 'staged', savedAt: new Date() }), /^Saved to the staged copy at /)
  assert.match(autosaveLabel({ ...base, target: 'draft', savedAt: new Date() }), /^Draft saved at /)
})

const post = (id, status, missingAlt = 0, hasStagedCopy = false) => ({ id, title: `Post ${id}`, status, missingAlt, hasStagedCopy })

test('bulk publish skips live posts and posts missing alt text, and everything when review is required', () => {
  const posts = [post('1', 'draft'), post('2', 'published'), post('3', 'draft', 2), post('4', 'scheduled')]
  const plan = planBulk('publish', posts, { reviewRequired: false })
  assert.deepEqual(plan.apply, ['1', '4'])
  assert.deepEqual(plan.skipped.map((s) => [s.id, s.reason]), [['2', 'Already live.'], ['3', 'Images without alt text.']])
  const locked = planBulk('publish', posts, { reviewRequired: true })
  assert.deepEqual(locked.apply, [])
  assert.match(locked.skipped[0].reason, /Review is required/)
})

test('bulk unpublish and delete: only live posts come down; a post with a staged change is not deleted', () => {
  const posts = [post('1', 'draft'), post('2', 'published'), post('3', 'published', 0, true)]
  assert.deepEqual(planBulk('unpublish', posts, { reviewRequired: true }).apply, ['2', '3'])
  const del = planBulk('delete', posts, { reviewRequired: false })
  assert.deepEqual(del.apply, ['1', '2'])
  assert.match(del.skipped[0].reason, /staged change/)
})

test('bulk actions are capped and summarized, and only known actions are accepted', () => {
  const many = Array.from({ length: MAX_BULK + 2 }, (_, i) => post(String(i), 'draft'))
  const plan = planBulk('delete', many, { reviewRequired: false })
  assert.equal(plan.apply.length, MAX_BULK)
  assert.equal(plan.skipped.length, 2)
  assert.equal(bulkSummary('publish', { apply: ['a'], skipped: [] }), 'Published 1 post.')
  assert.equal(bulkSummary('delete', { apply: ['a', 'b'], skipped: [{ id: 'c', title: 'C', reason: 'Why.' }] }), 'Deleted 2 posts. Skipped 1: C (Why.)')
  assert.equal(isBulkAction('publish'), true)
  assert.equal(isBulkAction('drop table'), false)
})

test('the admin theme: a cookie, three choices, system by default', () => {
  assert.equal(parseTheme(undefined), 'system')
  assert.equal(parseTheme('dark'), 'dark')
  assert.equal(parseTheme('<script>'), 'system')
  assert.equal(nextTheme('system'), 'light')
  assert.equal(nextTheme('light'), 'dark')
  assert.equal(nextTheme('dark'), 'system')
  assert.equal(themeCookie('dark', true), `${THEME_COOKIE}=dark; Path=/admin; Max-Age=31536000; SameSite=Lax; Secure`)
  assert.doesNotMatch(themeCookie('light', false), /Secure/)
})
