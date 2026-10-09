// The media library's rules (lib/media/library.ts): which bucket and ledger
// state each file is in, which posts use it, when a delete is refused, and
// how alt text is kept.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMediaLibrary, cleanAlt, filterMedia, mediaDeleteRefusal, usesByPath, MEDIA_ALT_MAX } from './library.ts'

const IMG = (path) => `https://proj.supabase.example/storage/v1/object/public/blog-images/${path}`
const LIVE = 'blog/aaaaaaaa-0000-4000-8000-000000000001.png'
const WAITING = 'blog/aaaaaaaa-0000-4000-8000-000000000002.webp'
const OLD = 'blog/aaaaaaaa-0000-4000-8000-000000000003.jpg'
const STRAY = 'blog/aaaaaaaa-0000-4000-8000-000000000004.png'
const BOTH = 'blog/aaaaaaaa-0000-4000-8000-000000000005.gif'
const P1 = '10000000-0000-4000-8000-000000000001'
const P2 = '10000000-0000-4000-8000-000000000002'
const doc = (...paths) => ({ type: 'doc', content: paths.map((p) => ({ type: 'image', attrs: { src: IMG(p), alt: 'x' } })) })

const uses = usesByPath({
  posts: [
    { id: P1, title: 'Dry gardens', featured_image_url: IMG(LIVE), body: doc(LIVE) },
    { id: P2, title: 'Rain barrels', body: doc(LIVE) },
  ],
  staged: [{ post_id: P2, title: 'Rain barrels, revised', body: doc(WAITING) }],
  revisions: [
    { post_id: P1, title: 'Dry gardens', body: doc(OLD) },
    { post_id: P1, title: 'Dry gardens', body: doc(OLD) },
  ],
})

test('reuse: one file used by two posts is listed once with both posts, and repeats inside a post count once', () => {
  assert.deepEqual(uses.get(LIVE), [
    { kind: 'post', postId: P1, title: 'Dry gardens' },
    { kind: 'post', postId: P2, title: 'Rain barrels' },
  ])
  assert.deepEqual(uses.get(OLD), [{ kind: 'revision', postId: P1, title: 'Dry gardens' }])
  assert.deepEqual(uses.get(WAITING), [{ kind: 'staged', postId: P2, title: 'Rain barrels, revised' }])
})

test('the library lists both buckets with the ledger: private, public (promoted by the kit), and public files the kit did not promote', () => {
  const lib = buildMediaLibrary({
    staged: [
      { name: 'aaaaaaaa-0000-4000-8000-000000000002.webp', created_at: '2026-10-09T08:00:00Z' },
      { name: 'aaaaaaaa-0000-4000-8000-000000000005.gif', created_at: '2026-10-01T08:00:00Z' },
      { name: 'not-ours.txt', created_at: '2026-10-09T09:00:00Z' },
    ],
    public: [
      { name: 'aaaaaaaa-0000-4000-8000-000000000001.png', created_at: '2026-10-05T08:00:00Z', metadata: { size: 2048 } },
      { name: 'aaaaaaaa-0000-4000-8000-000000000004.png', created_at: '2026-10-04T08:00:00Z' },
      { name: 'aaaaaaaa-0000-4000-8000-000000000005.gif', created_at: '2026-10-01T08:00:00Z' },
    ],
    promotions: [
      { path: LIVE, post_id: P1, promoted_at: '2026-10-05T09:00:00Z' },
      { path: BOTH, post_id: P2, promoted_at: '2026-10-02T09:00:00Z' },
    ],
    alts: [{ path: LIVE, alt: 'A gravel path between sage' }],
    uses,
  })
  assert.deepEqual(lib.map((a) => [a.path, a.state]), [
    [WAITING, 'private'],
    [LIVE, 'public'],
    [STRAY, 'not_promoted'],
    [BOTH, 'public'],
  ])
  const live = lib.find((a) => a.path === LIVE)
  assert.equal(live.alt, 'A gravel path between sage')
  assert.equal(live.promotedForPostId, P1)
  assert.equal(live.size, 2048)
  assert.equal(live.uses.length, 2)
  assert.match(live.deleteRefusal, /2 posts/)
  // A promotion whose staged clean-up failed shows its leftover copy.
  assert.equal(lib.find((a) => a.path === BOTH).leftoverStagedCopy, true)
  assert.equal(lib.find((a) => a.path === STRAY).deleteRefusal, null)
})

test('a used asset is never deleted: any use (live, staged or a kept revision) refuses, no use allows', () => {
  assert.equal(mediaDeleteRefusal([]), null)
  assert.match(mediaDeleteRefusal([{ kind: 'revision', postId: P1, title: 'x' }]), /kept revisions/)
  assert.match(mediaDeleteRefusal([{ kind: 'staged', postId: P1, title: 'x' }]), /1 staged change/)
})

test('filters: private, public, unused and missing alt', () => {
  const lib = buildMediaLibrary({
    staged: [{ name: 'aaaaaaaa-0000-4000-8000-000000000002.webp' }],
    public: [{ name: 'aaaaaaaa-0000-4000-8000-000000000004.png' }],
    promotions: [],
    alts: [{ path: WAITING, alt: 'Barrel under a downspout' }],
    uses,
  })
  assert.deepEqual(filterMedia(lib, 'private').map((a) => a.path), [WAITING])
  assert.deepEqual(filterMedia(lib, 'public').map((a) => a.path), [STRAY])
  assert.deepEqual(filterMedia(lib, 'unused').map((a) => a.path), [STRAY])
  assert.deepEqual(filterMedia(lib, 'missing_alt').map((a) => a.path), [STRAY])
})

test('alt text: trimmed, control characters out, at most 200 characters', () => {
  assert.equal(cleanAlt('  A field\nat dawn  '), 'A field at dawn')
  assert.equal(cleanAlt('a'.repeat(MEDIA_ALT_MAX)).length, MEDIA_ALT_MAX)
  assert.equal(cleanAlt('a'.repeat(MEDIA_ALT_MAX + 1)), null)
  assert.equal(cleanAlt(42), null)
})
