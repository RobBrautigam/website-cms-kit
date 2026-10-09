// Database tests for migration 003: the two-person lock made whole (image
// buckets and redirects), revisions of live posts, and scheduled publish and
// unpublish. Same engine as the other files: PGlite, one rolled-back
// transaction per test.
//
//   cd source/supabase/tests && npm install && npm test
//
// REVISIONS_MIGRATION=<path> swaps in another copy of migration 003, which is
// how each rule below was seen failing before it passed.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const MIGRATIONS = [
  here('./supabase-stub.sql'),
  here('../migrations/000_admin_cms_schema.sql'),
  here('../migrations/001_staging_and_approval.sql'),
  here('../migrations/002_hardening.sql'),
  process.env.REVISIONS_MIGRATION || here('../migrations/003_revisions_and_scheduling.sql'),
]

const SUPER = '00000000-0000-4000-8000-000000000001' // super_admin, two-factor on
const ADMIN = '00000000-0000-4000-8000-000000000002' // admin, two-factor on
const OUTSIDER = '00000000-0000-4000-8000-000000000004' // signed in, no admin role
const LIVE = '10000000-0000-4000-8000-000000000001'
const DRAFT = '10000000-0000-4000-8000-000000000002'
const LATER = '10000000-0000-4000-8000-000000000003' // scheduled, in the future
const DUE = '10000000-0000-4000-8000-000000000004' // scheduled, due already
const REDIRECT = '30000000-0000-4000-8000-000000000001'

let db

before(async () => {
  db = new PGlite()
  for (const file of MIGRATIONS) await db.exec(readFileSync(file, 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values
      ('${SUPER}', 'super@example.com'), ('${ADMIN}', 'admin@example.com'),
      ('${OUTSIDER}', 'outsider@example.com');
    insert into auth.mfa_factors (user_id, status) values
      ('${SUPER}', 'verified'), ('${ADMIN}', 'verified');
    insert into public.user_roles (user_id, role) values
      ('${SUPER}', 'super_admin'), ('${ADMIN}', 'admin');
    insert into public.blog_posts (id, title, slug, status, published_at, body) values
      ('${LIVE}', 'Live title', 'live-post', 'published', '2026-01-15T09:00:00+00:00', '{"type":"doc"}'),
      ('${DRAFT}', 'Draft title', 'draft-post', 'draft', null, '{}'),
      ('${LATER}', 'Later title', 'later-post', 'scheduled', now() + interval '3 days', '{}'),
      ('${DUE}', 'Due title', 'due-post', 'scheduled', now() - interval '5 minutes', '{}');
    insert into public.url_redirects (id, source, destination) values
      ('${REDIRECT}', '/old', '/new');
    -- The seed's own first revisions (inserting a live post keeps one); each
    -- test counts the revisions its own change makes.
    delete from public.blog_post_revisions;
  `)
})

after(async () => { await db.close() })

async function scenario(fn) {
  await db.exec('begin')
  try { await fn() } finally { await db.exec('rollback') }
}

async function as(role, claims) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims ? JSON.stringify(claims) : ''])
  if (role) await db.exec(`set local role ${role}`)
}
const asAnon = () => as('anon', { role: 'anon' })
const asUser = (sub, aal = 'aal2') => as('authenticated', { sub, role: 'authenticated', aal })
const asService = () => as('service_role', { role: 'service_role' })
const asOwner = () => as(null, null)

let savepoints = 0
async function expectError(sql, params, match) {
  const name = `sp_${++savepoints}`
  await db.exec(`savepoint ${name}`)
  try {
    await db.query(sql, params)
  } catch (e) {
    await db.exec(`rollback to savepoint ${name}`)
    if (match) assert.match(`${e.code} ${e.message}`, match)
    return e
  }
  await db.exec(`release savepoint ${name}`)
  assert.fail(`expected an error from: ${sql}`)
}

async function rows(sql, params) { return (await db.query(sql, params)).rows }

async function requireReview() {
  await asOwner()
  await db.exec(`create or replace function public.staging_review_required() returns boolean language sql immutable set search_path = '' as $$ select true; $$`)
}

async function stage(postId, title, slug) {
  const [r] = await rows(
    `insert into public.blog_post_staged_changes (post_id, title, slug, body)
     values ($1, $2, $3, '{"type":"doc"}') returning *`, [postId, title, slug])
  return r
}
const setStatus = (id, status) => rows(`update public.blog_post_staged_changes set review_status = $2 where id = $1 returning *`, [id, status])
async function approve(stageId, requester = ADMIN, approver = SUPER) {
  await asUser(requester); await setStatus(stageId, 'in_review')
  await asUser(approver); await setStatus(stageId, 'approved')
}
async function peek(sql, params) {
  await db.exec('savepoint peek')
  await asOwner()
  const r = await rows(sql, params)
  await db.exec('release savepoint peek')
  return r
}
const revisionsOf = (postId) => peek(`select * from public.blog_post_revisions where post_id = $1 order by seq`, [postId])

test('migration 003 can be run again on a database that already has it', () => scenario(async () => {
  await asOwner()
  await db.exec(readFileSync(MIGRATIONS[4], 'utf8'))
  const [t] = await rows(`select to_regclass('public.blog_post_revisions') as t`)
  assert.equal(t.t, 'blog_post_revisions')
}))

// ------------------------------------------------- the lock: image buckets

test('review required: an admin cannot write the public image bucket; only the server does', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  await expectError(`insert into storage.objects (bucket_id, name) values ('blog-images', 'blog/planted-image.png')`, [], /42501|row-level security/)
  await asService()
  await db.query(`insert into storage.objects (bucket_id, name) values ('blog-images', 'blog/promoted-image.png')`)
}))

test('review off: an admin may still write the public image bucket', () => scenario(async () => {
  await asUser(ADMIN)
  await db.query(`insert into storage.objects (bucket_id, name) values ('blog-images', 'blog/direct-image.png')`)
}))

test('review required: a staged image is write-once (no overwrite, no delete and re-upload)', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('blog-images-staged', 'blog/reviewed-image.png', $1)`, [ADMIN])
  const updated = await rows(`update storage.objects set owner = $1 where bucket_id = 'blog-images-staged' and name = 'blog/reviewed-image.png' returning name`, [SUPER])
  assert.equal(updated.length, 0)
  const deleted = await rows(`delete from storage.objects where bucket_id = 'blog-images-staged' and name = 'blog/reviewed-image.png' returning name`)
  assert.equal(deleted.length, 0)
  assert.equal((await peek(`select 1 from storage.objects where bucket_id = 'blog-images-staged' and name = 'blog/reviewed-image.png'`)).length, 1)
}))

test('image promotions and AI usage are server-only tables', () => scenario(async () => {
  for (const t of ['blog_image_promotions', 'ai_usage']) {
    await asAnon()
    await expectError(`select * from public.${t}`, [], /permission denied/)
    await asUser(ADMIN)
    await expectError(`select * from public.${t}`, [], /permission denied/)
    await asService()
    await rows(`select * from public.${t}`)
  }
}))

// ------------------------------------------------- the lock: redirects

test('review required: a new redirect waits disabled until a second admin enables it', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  const [r] = await rows(`insert into public.url_redirects (source, destination, enabled) values ('/promo', 'https://evil.example', true) returning *`)
  assert.equal(r.enabled, false)
  assert.equal(r.changed_by, ADMIN)
  await expectError(`update public.url_redirects set enabled = true where id = $1`, [r.id], /teammate/)
  await asUser(SUPER)
  const [on] = await rows(`update public.url_redirects set enabled = true where id = $1 returning *`, [r.id])
  assert.equal(on.enabled, true)
  assert.equal(on.changed_by, ADMIN)
}))

test('review required: changing where a live redirect points takes it offline until approved', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  const [r] = await rows(`update public.url_redirects set destination = 'https://evil.example' where id = $1 returning *`, [REDIRECT])
  assert.equal(r.enabled, false)
  assert.equal(r.changed_by, ADMIN)
  // Forging the changer is ignored.
  const [f] = await rows(`update public.url_redirects set changed_by = $2 where id = $1 returning changed_by`, [REDIRECT, SUPER])
  assert.equal(f.changed_by, ADMIN)
}))

test('review required: turning a redirect off, editing its notes and deleting it stay free', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  const [n] = await rows(`update public.url_redirects set notes = 'kept for the spring sale' where id = $1 returning enabled`, [REDIRECT])
  assert.equal(n.enabled, true)
  const [off] = await rows(`update public.url_redirects set enabled = false where id = $1 returning enabled`, [REDIRECT])
  assert.equal(off.enabled, false)
  assert.equal((await rows(`delete from public.url_redirects where id = $1 returning id`, [REDIRECT])).length, 1)
}))

test('review required: the server still counts hits on a live redirect', () => scenario(async () => {
  await requireReview()
  await asService()
  const [r] = await rows(`select public.record_redirect_hit($1, '203.0.113.9', 5, 100, 3600) as counted`, [REDIRECT])
  assert.equal(r.counted, true)
}))

test('review off: a new redirect is live at once, as before', () => scenario(async () => {
  await asUser(ADMIN)
  const [r] = await rows(`insert into public.url_redirects (source, destination) values ('/promo', '/sale') returning enabled`)
  assert.equal(r.enabled, true)
}))

// ------------------------------------------------- revisions

test('publishing a staged change keeps a revision: who, when, and what changed', () => scenario(async () => {
  await asUser(ADMIN)
  const s = await stage(LIVE, 'New live title', 'live-post')
  await rows(`select public.publish_staged_posts($1)`, [[s.id]])
  const revs = await revisionsOf(LIVE)
  assert.equal(revs.length, 1)
  assert.equal(revs[0].saved_by, ADMIN)
  assert.equal(revs[0].title, 'New live title')
  assert.deepEqual(revs[0].changed_fields, ['title'])
  assert.ok(revs[0].saved_at)
}))

test('saving a draft keeps no revision; taking a live post down keeps one', () => scenario(async () => {
  await asUser(ADMIN)
  await rows(`update public.blog_posts set title = 'Draft, edited' where id = $1`, [DRAFT])
  assert.equal((await revisionsOf(DRAFT)).length, 0)
  await rows(`update public.blog_posts set status = 'draft' where id = $1`, [LIVE])
  const revs = await revisionsOf(LIVE)
  assert.equal(revs.length, 1)
  assert.deepEqual(revs[0].changed_fields, ['status'])
  assert.equal(revs[0].status, 'draft')
}))

test('revisions: admins read them; the public and outsiders do not; nobody edits them', () => scenario(async () => {
  await asUser(ADMIN)
  await rows(`update public.blog_posts set status = 'draft' where id = $1`, [LIVE])
  assert.equal((await rows(`select id from public.blog_post_revisions where post_id = $1`, [LIVE])).length, 1)
  await asUser(OUTSIDER)
  assert.equal((await rows(`select id from public.blog_post_revisions`)).length, 0)
  await asAnon()
  await expectError(`select id from public.blog_post_revisions`, [], /permission denied/)
  await asUser(ADMIN)
  await expectError(`update public.blog_post_revisions set title = 'rewritten'`, [], /permission denied/)
  await expectError(`delete from public.blog_post_revisions`, [], /permission denied/)
  await expectError(`insert into public.blog_post_revisions (post_id, title, slug, status) values ($1, 'forged', 'x', 'published')`, [LIVE], /permission denied/)
}))

test('revisions: the newest 100 per post are kept', () => scenario(async () => {
  await asOwner()
  for (let i = 0; i < 103; i++) {
    await db.query(`update public.blog_posts set title = $2 where id = $1`, [LIVE, `Title ${i}`])
  }
  const revs = await revisionsOf(LIVE)
  assert.equal(revs.length, 100)
  assert.equal(revs.at(-1).title, 'Title 102')
}))

// ------------------------------------------------- scheduled publish and unpublish

test('the scheduler publishes a due post, leaves a future one, and records both', () => scenario(async () => {
  await asOwner()
  const [r] = await rows(`select public.run_scheduled_publishing() as result`)
  assert.equal(r.result.published, 1)
  const [due] = await peek(`select status from public.blog_posts where id = $1`, [DUE])
  const [later] = await peek(`select status from public.blog_posts where id = $1`, [LATER])
  assert.equal(due.status, 'published')
  assert.equal(later.status, 'scheduled')
  const log = await peek(`select actor_email, action, resource_id from public.admin_audit_log where action like 'blog_post.scheduled%'`)
  assert.deepEqual(log.map((l) => [l.actor_email, l.action, l.resource_id]), [['scheduler', 'blog_post.scheduled_publish', DUE]])
  const revs = await revisionsOf(DUE)
  assert.equal(revs.length, 1)
  assert.equal(revs[0].saved_by, null)
}))

test('the scheduler takes a post down at its unpublish time', () => scenario(async () => {
  await asOwner()
  await db.query(`update public.blog_posts set unpublish_at = now() - interval '1 minute' where id = $1`, [LIVE])
  const [r] = await rows(`select public.run_scheduled_publishing() as result`)
  assert.equal(r.result.unpublished, 1)
  const [p] = await peek(`select status, unpublish_at from public.blog_posts where id = $1`, [LIVE])
  assert.equal(p.status, 'draft')
  assert.equal(p.unpublish_at, null)
  assert.equal((await peek(`select 1 from public.admin_audit_log where action = 'blog_post.scheduled_unpublish'`)).length, 1)
}))

test('visitors see a due scheduled post before the scheduler runs, and never a post past its unpublish time', () => scenario(async () => {
  await asOwner()
  await db.query(`update public.blog_posts set unpublish_at = now() - interval '1 minute' where id = $1`, [LIVE])
  await asAnon()
  const seen = (await rows(`select id from public.blog_posts order by slug`)).map((r) => r.id)
  assert.deepEqual(seen, [DUE])
}))

test('only the server and the scheduler can run the scheduler function', () => scenario(async () => {
  for (const who of [asAnon, () => asUser(ADMIN)]) {
    await who()
    await expectError(`select public.run_scheduled_publishing()`, [], /permission denied/)
  }
  await asService()
  await rows(`select public.run_scheduled_publishing()`)
}))

test('an unpublish time must come after the publish time', () => scenario(async () => {
  await asUser(ADMIN)
  await expectError(`update public.blog_posts set unpublish_at = published_at - interval '1 day' where id = $1`, [LIVE], /^23514 /)
}))

test('review required: a scheduled post can be pushed later or given an end date, never pulled earlier without approval', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  await rows(`update public.blog_posts set published_at = published_at + interval '1 day' where id = $1`, [LATER])
  await rows(`update public.blog_posts set unpublish_at = now() + interval '30 days' where id = $1`, [LIVE])
  await expectError(`update public.blog_posts set published_at = now() + interval '1 hour' where id = $1`, [LATER], /Review is required/)
}))

test('review required: an approved staged copy of a scheduled post publishes into it and keeps the date', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  const s = await stage(LATER, 'Later, edited', 'later-post')
  await approve(s.id)
  await asUser(SUPER)
  await rows(`select public.publish_staged_posts($1)`, [[s.id]])
  const [p] = await peek(`select title, status from public.blog_posts where id = $1`, [LATER])
  assert.deepEqual([p.title, p.status], ['Later, edited', 'scheduled'])
}))

// The review fixes (the session's one reviewer).

test('review required: one admin cannot bring back a post past its end date by clearing or moving the end date', () => scenario(async () => {
  await asOwner()
  await db.query(`update public.blog_posts set unpublish_at = now() - interval '1 minute' where id = $1`, [LIVE])
  await requireReview()
  await asUser(ADMIN)
  await expectError(`update public.blog_posts set unpublish_at = null where id = $1`, [LIVE], /Review is required/)
  await expectError(`update public.blog_posts set unpublish_at = now() + interval '1 day' where id = $1`, [LIVE], /Review is required/)
  // An end date that has not passed can still be moved, and taking the post down stays free.
  await rows(`update public.blog_posts set unpublish_at = now() + interval '10 days' where id = $1`, [LATER])
  await rows(`update public.blog_posts set unpublish_at = now() + interval '20 days' where id = $1`, [LATER])
  await rows(`update public.blog_posts set status = 'draft' where id = $1`, [LIVE])
}))

test('taking a post down clears its end date, so it can be published again later', () => scenario(async () => {
  await asUser(ADMIN)
  await rows(`update public.blog_posts set unpublish_at = now() + interval '2 days' where id = $1`, [LIVE])
  await rows(`update public.blog_posts set status = 'draft' where id = $1`, [LIVE])
  const [p] = await peek(`select unpublish_at from public.blog_posts where id = $1`, [LIVE])
  assert.equal(p.unpublish_at, null)
  await rows(`update public.blog_posts set status = 'published', published_at = now() + interval '3 days' where id = $1`, [LIVE])
}))

test('deleting a post keeps its revisions', () => scenario(async () => {
  await asUser(ADMIN)
  await rows(`update public.blog_posts set status = 'draft' where id = $1`, [LIVE])
  assert.equal((await revisionsOf(LIVE)).length, 1)
  await rows(`delete from public.blog_posts where id = $1`, [LIVE])
  assert.equal((await revisionsOf(LIVE)).length, 1)
}))

test('review required: a redirect with no recorded changer (from before the lock) is not switched on by one admin', () => scenario(async () => {
  await asOwner()
  await db.query(`update public.url_redirects set enabled = false where id = $1`, [REDIRECT])
  await requireReview()
  await asUser(ADMIN)
  await expectError(`update public.url_redirects set enabled = true where id = $1`, [REDIRECT], /teammate/)
  // Saving it once records the changer; then a teammate switches it on.
  await rows(`update public.url_redirects set destination = '/newer' where id = $1`, [REDIRECT])
  await asUser(SUPER)
  const [on] = await rows(`update public.url_redirects set enabled = true where id = $1 returning *`, [REDIRECT])
  assert.equal(on.enabled, true)
}))
