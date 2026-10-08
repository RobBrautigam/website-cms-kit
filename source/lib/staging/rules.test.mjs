// Tests for the staging rules the admin screens use. Run with the database
// tests (`npm test` in source/supabase/tests) or on their own:
//   node --test source/lib/staging/rules.test.mjs
// Node 22.18+ reads the TypeScript module directly (type stripping).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  availableActions,
  checkPublishSelection,
  isSameOriginPost,
  pickStagedContent,
  reviewLabel,
  safePreviewPath,
} from './rules.ts'

const ME = 'user-me'
const TEAMMATE = 'user-teammate'
const stage = (reviewStatus, stagedBy = ME, title = 'A post') => ({ id: `s-${reviewStatus}`, reviewStatus, stagedBy, title })

test('a staged change can be published, sent for review or discarded, not approved', () => {
  const a = availableActions(stage('staged'), ME)
  assert.deepEqual(a, { publish: true, requestReview: true, approve: false, withdraw: false, discard: true })
})

test('a change in review cannot be published until someone approves it', () => {
  const a = availableActions(stage('in_review', TEAMMATE), ME)
  assert.equal(a.publish, false)
  assert.equal(a.approve, true)
  assert.equal(a.withdraw, true)
  assert.equal(a.requestReview, false)
})

test('nobody approves their own change', () => {
  assert.equal(availableActions(stage('in_review', ME), ME).approve, false)
  assert.equal(availableActions(stage('in_review', ME), null).approve, false)
})

test('an approved change can be published or taken back to staged', () => {
  const a = availableActions(stage('approved', TEAMMATE), ME)
  assert.equal(a.publish, true)
  assert.equal(a.withdraw, true)
  assert.equal(a.approve, false)
})

test('when review is required, only approved changes can be published', () => {
  assert.equal(availableActions(stage('staged'), ME, { reviewRequired: true }).publish, false)
  assert.equal(availableActions(stage('approved', TEAMMATE), ME, { reviewRequired: true }).publish, true)
})

test('a publish pick must not be empty', () => {
  const r = checkPublishSelection([])
  assert.equal(r.ok, false)
  assert.match(r.message, /Pick at least one/)
})

test('a publish pick with a change in review is refused and names it', () => {
  const r = checkPublishSelection([stage('staged', ME, 'Fine'), stage('in_review', ME, 'Waiting')])
  assert.equal(r.ok, false)
  assert.match(r.message, /"Waiting" needs an approval/)
})

test('a publish pick of staged and approved changes is fine, unless review is required', () => {
  const picks = [stage('staged'), stage('approved', TEAMMATE)]
  assert.deepEqual(checkPublishSelection(picks), { ok: true })
  assert.equal(checkPublishSelection(picks, { reviewRequired: true }).ok, false)
})

test('only the editable content fields are copied into a staged change', () => {
  const picked = pickStagedContent({
    title: 'T', slug: 's', excerpt: 'e', featured_image_url: null, featured_image_alt: 'a',
    body: { type: 'doc' }, categories: ['x'], meta_description: 'm', author_slug: 'au',
    // never trusted from a client:
    review_status: 'approved', approved_by: 'someone', staged_by: 'someone', post_id: 'other', status: 'published', id: 'x',
  })
  assert.deepEqual(Object.keys(picked).sort(), [
    'author_slug', 'body', 'categories', 'excerpt', 'featured_image_alt', 'featured_image_url', 'meta_description', 'slug', 'title',
  ])
})

test('missing content fields get safe empty values', () => {
  const picked = pickStagedContent({ title: 'T', slug: 's' })
  assert.deepEqual(picked.body, {})
  assert.deepEqual(picked.categories, [])
  assert.equal(picked.excerpt, null)
})

test('the preview only goes to a path on this site', () => {
  assert.equal(safePreviewPath('/blog'), '/blog')
  assert.equal(safePreviewPath('/blog/my-post?x=1#top'), '/blog/my-post?x=1#top')
  assert.equal(safePreviewPath(undefined), '/')
  assert.equal(safePreviewPath(''), '/')
})

test('the preview refuses anything that could leave the site', () => {
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', 'blog', '/blog\nSet-Cookie: x', '/a\\b', `/${'a'.repeat(600)}`, 42]) {
    assert.equal(safePreviewPath(bad), null, String(bad))
  }
})

test('the preview switch only accepts a form posted from this site', () => {
  const url = 'https://site.example/api/admin/preview'
  assert.equal(isSameOriginPost('https://site.example', null, url), true)
  assert.equal(isSameOriginPost(null, 'same-origin', url), true)
  assert.equal(isSameOriginPost('https://evil.example', null, url), false)
  assert.equal(isSameOriginPost('https://site.example.evil.example', null, url), false)
  assert.equal(isSameOriginPost('null', null, url), false)
  // An opaque origin falls back to the browser-set Sec-Fetch-Site header.
  assert.equal(isSameOriginPost('null', 'same-origin', url), true)
  assert.equal(isSameOriginPost(null, 'cross-site', url), false)
  assert.equal(isSameOriginPost(null, null, url), false)
})

test('review states have plain labels', () => {
  assert.equal(reviewLabel('staged'), 'Staged')
  assert.equal(reviewLabel('in_review'), 'In review')
  assert.equal(reviewLabel('approved'), 'Approved')
})
