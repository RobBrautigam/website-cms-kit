// 1.5.0: the media library's server actions (app/(admin)/admin/media/actions.ts)
// and its loader (lib/media/load.ts), with the stand-ins in ./stubs/. The
// database half of each rule (who may write alt text, which deletes the
// storage policies refuse) is media.test.mjs.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { calls, fakes, resetStubs } from './stubs/stubs.mjs'

const media = () => import(new URL('../../app/(admin)/admin/media/actions.ts', import.meta.url).href)
const IMG = (path) => `https://proj.supabase.example/storage/v1/object/public/blog-images/${path}`
const A = 'blog/aaaaaaaa-0000-4000-8000-000000000001.png'
const B = 'blog/aaaaaaaa-0000-4000-8000-000000000002.webp'
const POST_ID = '10000000-0000-4000-8000-000000000001'
const doc = (...paths) => ({ type: 'doc', content: paths.map((p) => ({ type: 'image', attrs: { src: IMG(p), alt: 'x' } })) })

beforeEach(resetStubs)

test('alt text per asset: saved trimmed, created on first save and updated after, audited; bad paths and long text refused', async () => {
  const { saveMediaAlt } = await media()
  let r = await saveMediaAlt(A, '  A gravel path  ')
  assert.equal(r.ok, true)
  assert.deepEqual(fakes.tables.blog_media.map((m) => [m.path, m.alt]), [[A, 'A gravel path']])
  r = await saveMediaAlt(A, 'A gravel path between sage')
  assert.equal(r.ok, true)
  assert.deepEqual(fakes.tables.blog_media.map((m) => [m.path, m.alt]), [[A, 'A gravel path between sage']])
  assert.deepEqual(calls.audit, ['media.alt_update', 'media.alt_update'])
  assert.equal((await saveMediaAlt('../../etc/passwd', 'x')).ok, false)
  assert.equal((await saveMediaAlt(A, 'a'.repeat(201))).ok, false)
  assert.equal(calls.audit.length, 2)
})

test('a used asset is never deleted: the action refuses before touching storage', async () => {
  const { deleteMediaAsset } = await media()
  fakes.storage.public.add(A)
  fakes.rpc.blog_image_in_use = () => ({ data: true, error: null })
  const r = await deleteMediaAsset(A)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'conflict')
  assert.match(r.error, /in use/i)
  assert.ok(!calls.order.some((o) => o.startsWith('remove')))
  assert.equal(fakes.storage.public.has(A), true)
  assert.deepEqual(calls.audit, [])
})

test('a used asset is never deleted: a failed in-use check refuses too (never deletes on a guess)', async () => {
  const { deleteMediaAsset } = await media()
  fakes.storage.public.add(A)
  fakes.rpc.blog_image_in_use = () => ({ data: null, error: { message: 'function blog_image_in_use does not exist' } })
  const r = await deleteMediaAsset(A)
  assert.equal(r.ok, false)
  assert.match(r.error, /migration 004/)
  assert.equal(fakes.storage.public.has(A), true)
})

test('deleting an unused public image keeps its ledger row, so a later upload at that path is never promoted into its place', async () => {
  const { deleteMediaAsset } = await media()
  const { promoteImages } = await import('../../lib/staging/promote-images.ts')
  fakes.storage.public.add(A)
  fakes.tables.blog_image_promotions = [{ path: A, post_id: POST_ID }]
  fakes.tables.blog_media = [{ path: A, alt: 'old' }]
  fakes.rpc.blog_image_in_use = () => ({ data: false, error: null })
  const r = await deleteMediaAsset(A)
  assert.equal(r.ok, true)
  assert.equal(fakes.storage.public.has(A), false)
  assert.deepEqual(fakes.tables.blog_image_promotions.map((p) => p.path), [A])
  assert.deepEqual(fakes.tables.blog_media, [])
  assert.deepEqual(calls.audit, ['media.delete'])
  // The ledger still remembers the path: a staged file there stays private.
  fakes.storage.staged.add(A)
  await promoteImages({ featured_image_url: IMG(A) }, POST_ID)
  assert.equal(fakes.storage.public.has(A), false)
})

test('the storage policy decides: when nothing was removed (write-once under review) the action says why and keeps the alt text', async () => {
  const { deleteMediaAsset } = await media()
  fakes.storage.staged.add(B)
  fakes.tables.blog_media = [{ path: B, alt: 'kept' }]
  fakes.rpc.blog_image_in_use = () => ({ data: false, error: null })
  fakes.storage.refuseRemove = ['blog-images-staged', 'blog-images']
  const r = await deleteMediaAsset(B)
  assert.equal(r.ok, false)
  assert.match(r.error, /write-once|review/i)
  assert.equal(fakes.storage.staged.has(B), true)
  assert.deepEqual(fakes.tables.blog_media.map((m) => m.alt), ['kept'])
  assert.deepEqual(calls.audit, [])
})

test('a testimonial\'s images go public when it is saved (they never did since 1.3.0), through the same ledger', async () => {
  const { createTestimonial } = await import(new URL('../../app/(admin)/admin/testimonials/actions.ts', import.meta.url).href)
  fakes.storage.staged.add(A)
  const form = new FormData()
  form.set('kind', 'text')
  form.set('name', 'Sample Customer')
  form.set('quote', 'It worked.')
  form.set('headshot_url', IMG(A))
  const r = await createTestimonial({ ok: true }, form)
  assert.equal(r.ok, true)
  assert.equal(fakes.storage.public.has(A), true)
  assert.equal(fakes.storage.staged.has(A), false)
  assert.deepEqual(fakes.tables.blog_image_promotions.map((p) => p.path), [A])
  // An object the kit did not promote is still refused, and the save says so.
  fakes.storage.staged.add(B)
  fakes.storage.public.add(B)
  form.set('headshot_url', IMG(B))
  const refused = await createTestimonial({ ok: true }, form)
  assert.equal(refused.ok, false)
  assert.match(refused.error, /Saved/)
  assert.match(refused.error, /not made public by the kit/)
})

test('the staged-image cleanup keeps a file a testimonial uses', async () => {
  const { cleanupStagedImages } = await import(new URL('../../app/(admin)/admin/staging/actions.ts', import.meta.url).href)
  fakes.storage.staged.add(A)
  fakes.storage.staged.add(B)
  fakes.tables.blog_posts = []
  fakes.tables.blog_post_staged_changes = []
  fakes.tables.blog_post_revisions = []
  fakes.tables.testimonials = [{ id: 't1', name: 'Sample Customer', headshot_url: IMG(A) }]
  const r = await cleanupStagedImages()
  assert.equal(r.ok, true)
  assert.deepEqual([...fakes.storage.staged], [A])
})

test('the library: both buckets with their ledger rows, alt text and uses; the picker offers each asset with its alt', async () => {
  const { loadMediaLibraryAction, listMediaForPicker } = await media()
  fakes.storage.public.add(A)
  fakes.storage.staged.add(B)
  fakes.tables.blog_image_promotions = [{ path: A, post_id: POST_ID, promoted_at: '2026-10-05T09:00:00Z' }]
  fakes.tables.blog_media = [{ path: A, alt: 'A gravel path' }]
  fakes.tables.blog_posts = [{ id: POST_ID, title: 'Dry gardens', featured_image_url: IMG(A), body: doc() }]
  fakes.tables.blog_post_staged_changes = [{ post_id: POST_ID, title: 'Dry gardens', body: doc(A, B) }]
  fakes.tables.blog_post_revisions = []
  fakes.tables.testimonials = [{ id: 't1', name: 'Sample Customer', screenshot_url: IMG(A) }]
  const lib = await loadMediaLibraryAction()
  assert.equal(lib.ok, true)
  const byPath = Object.fromEntries(lib.data.assets.map((a) => [a.path, a]))
  assert.equal(byPath[A].state, 'public')
  assert.equal(byPath[A].alt, 'A gravel path')
  assert.deepEqual(byPath[A].uses.map((u) => u.kind), ['post', 'staged', 'testimonial'])
  assert.equal(byPath[B].state, 'private')
  assert.match(byPath[B].deleteRefusal, /staged change/)
  const picker = await listMediaForPicker()
  assert.equal(picker.ok, true)
  assert.deepEqual(
    picker.data.map((p) => [p.path, p.url, p.alt]),
    lib.data.assets.map((a) => [a.path, IMG(a.path), a.alt])
  )
  assert.ok(calls.requireAdmin >= 2)
})
