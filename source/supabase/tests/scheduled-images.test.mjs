// 1.5.0, review finding 8 of 1.4.0: a scheduled post's images were public
// from the moment it was scheduled, because the database scheduler cannot
// copy storage files. With SCHEDULED_IMAGES=at_publish they wait for the
// date, and a server job (app/api/cron/scheduled-publishing) copies them just
// before it. Without the setting, nothing changes.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { calls, fakes, resetStubs } from './stubs/stubs.mjs'

const staging = () => import(new URL('../../app/(admin)/admin/staging/actions.ts', import.meta.url).href)
const cron = () => import(new URL('../../app/api/cron/scheduled-publishing/route.ts', import.meta.url).href)
const timing = () => import(new URL('../../lib/staging/scheduled-images.ts', import.meta.url).href)
const IMG = (path) => `https://proj.supabase.example/storage/v1/object/public/blog-images/${path}`
const A = 'blog/0a1b2c3d4e5f.png'
const B = 'blog/11112222-3333-4444-5555-666677778888.webp'
const POST_ID = '10000000-0000-4000-8000-000000000001'
const LATER_ID = '10000000-0000-4000-8000-000000000002'
const STAGE_ID = '20000000-0000-4000-8000-000000000001'
const SECRET = 'a-sample-secret-that-is-long-enough-0123456789'
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString()

const stageRow = () => ({
  id: STAGE_ID, post_id: POST_ID, title: 'Dry gardens', slug: 'dry-gardens', review_status: 'approved',
  featured_image_url: IMG(A), featured_image_alt: 'A gravel path', body: { type: 'doc', content: [] },
  post: { slug: 'dry-gardens' },
})
const cronCall = (auth) =>
  new Request('https://cms.example.com/api/cron/scheduled-publishing', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  })

beforeEach(() => {
  resetStubs()
  delete process.env.SCHEDULED_IMAGES
  delete process.env.CRON_SECRET
})
afterEach(() => {
  delete process.env.SCHEDULED_IMAGES
  delete process.env.CRON_SECRET
})

test('by default nothing changes: a scheduled post\'s images go public when its change is published', async () => {
  const { publishStaged } = await staging()
  fakes.tables.blog_post_staged_changes = [stageRow()]
  fakes.tables.blog_posts = [{ id: POST_ID, status: 'scheduled', published_at: inMinutes(60 * 24) }]
  fakes.storage.staged.add(A)
  assert.equal((await publishStaged([STAGE_ID])).ok, true)
  assert.equal(fakes.storage.public.has(A), true)
})

test('at_publish: a scheduled post\'s images stay private when it is scheduled, and the retry button says why', async () => {
  process.env.SCHEDULED_IMAGES = 'at_publish'
  const { publishStaged, promotePostImages } = await staging()
  fakes.tables.blog_post_staged_changes = [stageRow()]
  fakes.tables.blog_posts = [{ id: POST_ID, title: 'Dry gardens', status: 'scheduled', published_at: inMinutes(60 * 24), featured_image_url: IMG(A) }]
  fakes.storage.staged.add(A)
  const r = await publishStaged([STAGE_ID])
  assert.equal(r.ok, true)
  assert.equal(r.data?.imageWarning, undefined)
  assert.equal(fakes.storage.public.has(A), false)
  assert.equal(fakes.tables.blog_image_promotions, undefined)
  const retry = await promotePostImages(POST_ID)
  assert.equal(retry.ok, true)
  assert.equal(retry.data?.waitsForDate, true)
  assert.equal(fakes.storage.public.has(A), false)
  // A scheduled post already inside the lead time goes public at once.
  fakes.tables.blog_posts[0].published_at = inMinutes(1)
  assert.equal((await promotePostImages(POST_ID)).ok, true)
  assert.equal(fakes.storage.public.has(A), true)
})

test('at_publish: when the schedule cannot be read, nothing goes public early (fails closed) and the warning says why', async () => {
  process.env.SCHEDULED_IMAGES = 'at_publish'
  const { publishStaged } = await staging()
  fakes.tables.blog_post_staged_changes = [stageRow()]
  fakes.tables.blog_posts = [{ id: POST_ID, title: 'Dry gardens', status: 'scheduled', published_at: inMinutes(60 * 24), featured_image_url: IMG(A) }]
  fakes.storage.staged.add(A)
  fakes.failSelect.blog_posts = 'connection reset'
  const r = await publishStaged([STAGE_ID])
  assert.equal(fakes.storage.public.has(A), false)
  assert.match(r.data?.imageWarning ?? '', /could not be read/)
})

test('the job also copies the images of a post the database scheduler already published (the 003 job still running)', async () => {
  process.env.SCHEDULED_IMAGES = 'at_publish'
  process.env.CRON_SECRET = SECRET
  const { POST } = await cron()
  fakes.tables.blog_posts = [
    { id: POST_ID, title: 'Published by the database job', status: 'published', published_at: inMinutes(-1), featured_image_url: IMG(A) },
    { id: LATER_ID, title: 'Published long ago', status: 'published', published_at: inMinutes(-60 * 48), featured_image_url: IMG(B) },
  ]
  fakes.storage.staged.add(A)
  fakes.storage.staged.add(B)
  fakes.rpc.run_scheduled_publishing = () => ({ data: { published: 0, unpublished: 0 }, error: null })
  const body = await (await POST(cronCall(`Bearer ${SECRET}`))).json()
  assert.equal(fakes.storage.public.has(A), true)
  assert.equal(fakes.storage.public.has(B), false)
  assert.equal(body.imagesPromoted, 1)
})

test('the job refuses without a long enough secret (503) or with the wrong one (401), and does nothing', async () => {
  const { POST } = await cron()
  fakes.tables.blog_posts = [{ id: POST_ID, status: 'scheduled', published_at: inMinutes(1), featured_image_url: IMG(A) }]
  fakes.storage.staged.add(A)
  assert.equal((await POST(cronCall(`Bearer ${SECRET}`))).status, 503)
  process.env.CRON_SECRET = 'short'
  assert.equal((await POST(cronCall('Bearer short'))).status, 503)
  process.env.CRON_SECRET = SECRET
  assert.equal((await POST(cronCall())).status, 401)
  assert.equal((await POST(cronCall(`Bearer ${SECRET}x`))).status, 401)
  assert.equal((await POST(cronCall(`Basic ${SECRET}`))).status, 401)
  assert.equal(fakes.storage.public.size, 0)
  assert.deepEqual(calls.rpc, [])
})

test('the job copies the images of posts due within the lead time, leaves later ones private, then runs the scheduler', async () => {
  process.env.SCHEDULED_IMAGES = 'at_publish'
  process.env.CRON_SECRET = SECRET
  const { POST } = await cron()
  fakes.tables.blog_posts = [
    { id: POST_ID, title: 'Due', status: 'scheduled', published_at: inMinutes(1), featured_image_url: IMG(A) },
    { id: LATER_ID, title: 'Later', status: 'scheduled', published_at: inMinutes(60), featured_image_url: IMG(B) },
  ]
  fakes.storage.staged.add(A)
  fakes.storage.staged.add(B)
  fakes.rpc.run_scheduled_publishing = () => ({ data: { published: 1, unpublished: 0 }, error: null })
  const res = await POST(cronCall(`Bearer ${SECRET}`))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body, { imagesPromoted: 1, imageProblems: [], published: 1, unpublished: 0 })
  assert.equal(fakes.storage.public.has(A), true)
  assert.equal(fakes.storage.public.has(B), false)
  assert.deepEqual(calls.order.filter((o) => !o.startsWith('remove')), [`copy ${A}`, 'rpc run_scheduled_publishing'])
})

test('the job goes through the same ledger: an object the kit did not promote is refused and reported', async () => {
  process.env.CRON_SECRET = SECRET
  const { POST } = await cron()
  fakes.tables.blog_posts = [{ id: POST_ID, title: 'Due', status: 'scheduled', published_at: inMinutes(1), featured_image_url: IMG(A) }]
  fakes.storage.staged.add(A)
  fakes.storage.public.add(A)
  const body = await (await POST(cronCall(`Bearer ${SECRET}`))).json()
  assert.equal(body.imagesPromoted, 0)
  assert.equal(body.imageProblems.length, 1)
  assert.match(body.imageProblems[0].error, /not made public by the kit/)
})

test('the job answers failures with fixed text: no database or storage message leaves the server', async () => {
  process.env.CRON_SECRET = SECRET
  const { POST } = await cron()
  const INTERNAL = 'relation "internal_detail" does not exist at character 42'
  fakes.tables.blog_posts = [{ id: POST_ID, title: 'Due', status: 'scheduled', published_at: inMinutes(1), featured_image_url: IMG(A) }]
  fakes.storage.staged.add(A)
  fakes.storage.failCopy = 'internal_detail: connection reset by peer'
  fakes.rpc.run_scheduled_publishing = () => ({ data: null, error: { message: INTERNAL } })
  const res = await POST(cronCall(`Bearer ${SECRET}`))
  assert.equal(res.status, 500)
  const text = await res.text()
  assert.doesNotMatch(text, /internal_detail/)
  const body = JSON.parse(text)
  assert.match(body.error, /scheduler failed/i)
  assert.equal(body.imageProblems.length, 1)
  assert.match(body.imageProblems[0].error, /server log/)
})

test('timing: images wait only with the setting, only for a scheduled post, and only beyond the lead time', async () => {
  const { imagesWaitForDate, SCHEDULED_IMAGE_LEAD_SECONDS } = await timing()
  const now = new Date('2026-10-09T12:00:00Z')
  const at = (s) => new Date(now.getTime() + s * 1000).toISOString()
  const later = { status: 'scheduled', published_at: at(SCHEDULED_IMAGE_LEAD_SECONDS + 1) }
  assert.equal(imagesWaitForDate(later, now), false)
  process.env.SCHEDULED_IMAGES = 'at_publish'
  assert.equal(imagesWaitForDate(later, now), true)
  assert.equal(imagesWaitForDate({ status: 'scheduled', published_at: at(SCHEDULED_IMAGE_LEAD_SECONDS) }, now), false)
  assert.equal(imagesWaitForDate({ status: 'published', published_at: at(3600) }, now), false)
  assert.equal(imagesWaitForDate({ status: 'scheduled', published_at: 'not a date' }, now), false)
})
