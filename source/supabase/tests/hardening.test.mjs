// Database tests for migration 002 (hardening): the append-only audit log,
// per-caller rate limits, the redirect counter, the deferred slug check that
// lets two staged changes swap slugs, the opt-in two-person lock on live
// posts, and the private bucket for staged images. Same engine as
// staging.test.mjs: PGlite, one rolled-back transaction per test.
//
//   cd source/supabase/tests && npm install && npm test
//
// HARDENING_MIGRATION=<path> swaps in another copy of migration 002, which is
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
  process.env.HARDENING_MIGRATION || here('../migrations/002_hardening.sql'),
]

const SUPER = '00000000-0000-4000-8000-000000000001' // super_admin, two-factor on
const ADMIN = '00000000-0000-4000-8000-000000000002' // admin, two-factor on
const PLAIN = '00000000-0000-4000-8000-000000000003' // admin, no factor yet
const OUTSIDER = '00000000-0000-4000-8000-000000000004' // signed in, no admin role
const GONE = '00000000-0000-4000-8000-000000000005' // admin, deactivated
const LIVE = '10000000-0000-4000-8000-000000000001'
const DRAFT = '10000000-0000-4000-8000-000000000002'
const OTHER = '10000000-0000-4000-8000-000000000003'
const REDIRECT = '30000000-0000-4000-8000-000000000001'

let db

before(async () => {
  db = new PGlite()
  for (const file of MIGRATIONS) await db.exec(readFileSync(file, 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values
      ('${SUPER}', 'super@example.com'), ('${ADMIN}', 'admin@example.com'),
      ('${PLAIN}', 'plain@example.com'), ('${OUTSIDER}', 'outsider@example.com'),
      ('${GONE}', 'gone@example.com');
    insert into auth.mfa_factors (user_id, status) values
      ('${SUPER}', 'verified'), ('${ADMIN}', 'verified'), ('${GONE}', 'verified');
    insert into public.user_roles (user_id, role, deactivated_at) values
      ('${SUPER}', 'super_admin', null), ('${ADMIN}', 'admin', null),
      ('${PLAIN}', 'admin', null), ('${GONE}', 'admin', now());
    insert into public.blog_posts (id, title, slug, status, published_at, body) values
      ('${LIVE}', 'Live title', 'live-post', 'published', '2026-01-15T09:00:00+00:00', '{"type":"doc"}'),
      ('${DRAFT}', 'Draft title', 'draft-post', 'draft', null, '{}'),
      ('${OTHER}', 'Other live title', 'other-post', 'published', '2026-01-15T09:00:00+00:00', '{}');
    insert into public.url_redirects (id, source, destination) values
      ('${REDIRECT}', '/old', '/new');
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
async function livePost(id) {
  await db.exec('savepoint peek')
  await asOwner()
  const [r] = await rows(`select * from public.blog_posts where id = $1`, [id])
  await db.exec('release savepoint peek')
  return r
}
async function audit(action = 'blog_post.update', createdAt = null) {
  const [r] = await rows(
    `insert into public.admin_audit_log (actor_user_id, actor_email, action, created_at)
     values ($1, 'admin@example.com', $2, coalesce($3::timestamptz, now())) returning *`, [ADMIN, action, createdAt])
  return r
}

test('migration 002 can be run again on a database that already has it', () => scenario(async () => {
  await asOwner()
  await db.exec(readFileSync(MIGRATIONS[3], 'utf8'))
  const [c] = await rows(`select condeferrable from pg_constraint where conname = 'blog_posts_slug_key'`)
  assert.equal(c.condeferrable, true)
}))

// ------------------------------------------------------------- the audit log is append-only

test('the server can append to the audit log', () => scenario(async () => {
  await asService()
  const r = await audit()
  assert.equal(r.action, 'blog_post.update')
}))

test('nobody can edit an audit row, not even the service role or the table owner', () => scenario(async () => {
  await asService(); const r = await audit()
  await expectError(`update public.admin_audit_log set action = 'blog_post.delete' where id = $1`, [r.id], /append-only/)
  await asOwner()
  await expectError(`update public.admin_audit_log set actor_email = 'someone-else@example.com' where id = $1`, [r.id], /append-only/)
}))

test('nobody can delete a recent audit row', () => scenario(async () => {
  await asService(); const r = await audit()
  await expectError(`delete from public.admin_audit_log where id = $1`, [r.id], /append-only/)
  await asOwner()
  await expectError(`delete from public.admin_audit_log where id = $1`, [r.id], /append-only/)
}))

test('the audit log cannot be truncated', () => scenario(async () => {
  await asOwner(); await audit()
  await expectError(`truncate public.admin_audit_log`, [], /append-only/)
}))

test('retention still works: rows older than the retention window can be deleted', () => scenario(async () => {
  await asOwner()
  const old = await audit('blog_post.update', '2020-01-01T00:00:00Z')
  const recent = await audit()
  await asService()
  const gone = await rows(`delete from public.admin_audit_log where created_at < now() - public.admin_audit_log_retention() returning id`)
  assert.deepEqual(gone.map((r) => r.id), [old.id])
  assert.equal((await rows(`select id from public.admin_audit_log where id = $1`, [recent.id])).length, 1)
}))

test('deleting a user keeps their audit rows (the actor link is cleared, nothing else)', () => scenario(async () => {
  await asService(); const r = await audit()
  await asOwner()
  await db.query(`delete from auth.users where id = $1`, [ADMIN])
  const [after] = await rows(`select * from public.admin_audit_log where id = $1`, [r.id])
  assert.equal(after.actor_user_id, null)
  assert.equal(after.actor_email, 'admin@example.com')
}))

// ------------------------------------------------------------- per-caller rate limits

test('a caller gets the limit and no more inside one window', () => scenario(async () => {
  await asService()
  const answers = []
  for (let i = 0; i < 4; i++) {
    answers.push((await rows(`select public.consume_rate_limit('ai', 'user-1', 3, 3600) as ok`))[0].ok)
  }
  assert.deepEqual(answers, [true, true, true, false])
  assert.equal((await rows(`select public.consume_rate_limit('ai', 'user-2', 3, 3600) as ok`))[0].ok, true)
  assert.equal((await rows(`select public.consume_rate_limit('other', 'user-1', 3, 3600) as ok`))[0].ok, true)
}))

test('a new window starts the count again', () => scenario(async () => {
  await asService()
  for (let i = 0; i < 3; i++) await rows(`select public.consume_rate_limit('ai', 'user-1', 3, 60)`)
  assert.equal((await rows(`select public.consume_rate_limit('ai', 'user-1', 3, 60) as ok`))[0].ok, false)
  await db.query(`update public.api_rate_limits set window_started_at = now() - interval '2 minutes'`)
  assert.equal((await rows(`select public.consume_rate_limit('ai', 'user-1', 3, 60) as ok`))[0].ok, true)
}))

test('only the server can spend or read rate limits', () => scenario(async () => {
  for (const who of [asAnon, () => asUser(ADMIN)]) {
    await who()
    await expectError(`select public.consume_rate_limit('ai', 'x', 3, 60)`, [], /permission denied for function/)
    await expectError(`select * from public.api_rate_limits`, [], /permission denied/)
  }
}))

test('the public key can no longer bump a redirect counter directly', () => scenario(async () => {
  await asAnon()
  await expectError(`select public.increment_redirect_hit($1)`, [REDIRECT], /permission denied for function/)
  await expectError(`select public.record_redirect_hit($1, 'ip', 30, 1000, 600)`, [REDIRECT], /permission denied for function/)
}))

test('the redirect counter counts a caller up to the limit, then stops counting', () => scenario(async () => {
  await asService()
  const answers = []
  for (let i = 0; i < 3; i++) {
    answers.push((await rows(`select public.record_redirect_hit($1, '203.0.113.7', 2, 1000, 600) as counted`, [REDIRECT]))[0].counted)
  }
  assert.deepEqual(answers, [true, true, false])
  assert.equal((await rows(`select public.record_redirect_hit($1, '198.51.100.9', 2, 1000, 600) as counted`, [REDIRECT]))[0].counted, true)
  const [r] = await rows(`select hit_count from public.url_redirects where id = $1`, [REDIRECT])
  assert.equal(Number(r.hit_count), 3)
}))

test('one redirect has a ceiling across all callers, so rotating addresses cannot inflate it', () => scenario(async () => {
  await asService()
  const answers = []
  for (let i = 0; i < 4; i++) {
    answers.push((await rows(`select public.record_redirect_hit($1, $2, 30, 3, 600) as counted`, [REDIRECT, `198.51.100.${i}`]))[0].counted)
  }
  assert.deepEqual(answers, [true, true, true, false])
}))

// ------------------------------------------------------------- slug swap

test('two staged changes that swap slugs publish together in one batch', () => scenario(async () => {
  await asUser(ADMIN)
  const a = await stage(LIVE, 'Live title', 'other-post')
  const b = await stage(OTHER, 'Other live title', 'live-post')
  await rows(`select * from public.publish_staged_posts($1::uuid[])`, [[a.id, b.id]])
  assert.equal((await livePost(LIVE)).slug, 'other-post')
  assert.equal((await livePost(OTHER)).slug, 'live-post')
}))

test('a real slug clash still fails the whole batch inside the function', () => scenario(async () => {
  await asUser(ADMIN)
  const a = await stage(DRAFT, 'Clash', 'live-post')
  await expectError(`select * from public.publish_staged_posts($1::uuid[])`, [[a.id]], /23505|duplicate/)
  assert.equal((await livePost(DRAFT)).status, 'draft')
}))

// ------------------------------------------------------------- the opt-in two-person lock

test('review off (the default): admins still write live posts directly', () => scenario(async () => {
  await asUser(ADMIN)
  await db.query(`update public.blog_posts set title = 'Edited live' where id = $1`, [LIVE])
  assert.equal((await livePost(LIVE)).title, 'Edited live')
}))

test('review on: an admin cannot change a live post directly', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  await expectError(`update public.blog_posts set title = 'Sneaky edit' where id = $1`, [LIVE], /Review is required/)
  assert.equal((await livePost(LIVE)).title, 'Live title')
}))

test('review on: an admin cannot publish a draft directly or create a post as published', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  await expectError(`update public.blog_posts set status = 'published', published_at = now() where id = $1`, [DRAFT], /Review is required/)
  await expectError(`insert into public.blog_posts (title, slug, status) values ('New', 'new-live', 'published')`, [], /Review is required/)
  await expectError(`insert into public.blog_posts (title, slug, status, published_at) values ('New', 'new-later', 'scheduled', now())`, [], /Review is required/)
}))

test('review on: drafts stay free to write, and a live post can still be taken down', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  await db.query(`update public.blog_posts set title = 'Draft edited' where id = $1`, [DRAFT])
  await db.query(`insert into public.blog_posts (title, slug, status) values ('New draft', 'new-draft', 'draft')`)
  await db.query(`update public.blog_posts set status = 'draft' where id = $1`, [LIVE])
  assert.equal((await livePost(DRAFT)).title, 'Draft edited')
  assert.equal((await livePost(LIVE)).status, 'draft')
}))

test('review on: an approved staged change still publishes through the function', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN); const s = await stage(LIVE, 'Approved by a teammate', 'live-post')
  await approve(s.id)
  await asUser(ADMIN)
  await rows(`select * from public.publish_staged_posts($1::uuid[])`, [[s.id]])
  assert.equal((await livePost(LIVE)).title, 'Approved by a teammate')
}))

test('review on: copying an unapproved staged change onto the live post by hand is refused', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN); await stage(LIVE, 'Not approved yet', 'live-post')
  await expectError(`update public.blog_posts set title = 'Not approved yet', body = '{"type":"doc"}' where id = $1`, [LIVE], /Review is required/)
}))

test('review on: an approved change cannot be widened on the way to the live post', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN); const s = await stage(LIVE, 'Approved title', 'live-post')
  await approve(s.id)
  await asUser(ADMIN)
  await expectError(`update public.blog_posts set title = 'Approved title', body = '{"type":"doc","extra":true}' where id = $1`, [LIVE], /Review is required/)
}))

test('review on: server jobs on the service role are not blocked', () => scenario(async () => {
  await requireReview()
  await asService()
  await db.query(`update public.blog_posts set status = 'published', published_at = now() where id = $1`, [DRAFT])
  assert.equal((await livePost(DRAFT)).status, 'published')
}))

// ------------------------------------------------------------- staged images stay private

test('the staged-images bucket exists and is private, with the same limits as the public one', () => scenario(async () => {
  await asOwner()
  const [b] = await rows(`select * from storage.buckets where id = 'blog-images-staged'`)
  assert.equal(b.public, false)
  assert.equal(Number(b.file_size_limit), 5242880)
  assert.deepEqual(b.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
}))

test('an admin on a two-factor session can upload and read a staged image', () => scenario(async () => {
  await asUser(ADMIN)
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('blog-images-staged', 'blog/a.png', $1)`, [ADMIN])
  assert.equal((await rows(`select name from storage.objects where bucket_id = 'blog-images-staged'`)).length, 1)
}))

test('the public key, outsiders, deactivated admins and AAL1 sessions get nothing from the staged bucket', () => scenario(async () => {
  await asUser(ADMIN)
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('blog-images-staged', 'blog/a.png', $1)`, [ADMIN])
  await asAnon()
  assert.equal((await rows(`select name from storage.objects where bucket_id = 'blog-images-staged'`)).length, 0)
  for (const who of [() => asUser(OUTSIDER), () => asUser(GONE), () => asUser(SUPER, 'aal1')]) {
    await who()
    assert.equal((await rows(`select name from storage.objects where bucket_id = 'blog-images-staged'`)).length, 0)
    await expectError(`insert into storage.objects (bucket_id, name) values ('blog-images-staged', 'blog/b.png')`, [], /42501|row-level security/)
  }
}))
