// Database tests for staging and approval (migration 001), on a real Postgres
// engine compiled to WebAssembly (PGlite), so they run with no Supabase
// project and no network. Each test runs in a transaction that is rolled back.
//
//   cd source/supabase/tests && npm install && npm test
//
// STAGING_MIGRATION=<path> swaps in another copy of migration 001, which is
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
  process.env.STAGING_MIGRATION || here('../migrations/001_staging_and_approval.sql'),
  // 002 replaces publish_staged_posts() and adds the two-person lock, so the
  // staging rules are checked with it in place. SKIP_002=1 leaves it out.
  ...(process.env.SKIP_002 ? [] : [here('../migrations/002_hardening.sql')]),
]

// Fixed ids keep the failures readable.
const SUPER = '00000000-0000-4000-8000-000000000001' // super_admin, two-factor on
const ADMIN = '00000000-0000-4000-8000-000000000002' // admin, two-factor on
const PLAIN = '00000000-0000-4000-8000-000000000003' // admin, no factor yet
const OUTSIDER = '00000000-0000-4000-8000-000000000004' // signed in, no admin role
const GONE = '00000000-0000-4000-8000-000000000005' // admin, deactivated
const LIVE = '10000000-0000-4000-8000-000000000001' // a published post
const DRAFT = '10000000-0000-4000-8000-000000000002' // a never-published draft
const OTHER = '10000000-0000-4000-8000-000000000003' // a second published post
const FIRST_PUBLISHED = '2026-01-15T09:00:00+00:00'

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
      ('${LIVE}', 'Live title', 'live-post', 'published', '${FIRST_PUBLISHED}', '{"type":"doc"}'),
      ('${DRAFT}', 'Draft title', 'draft-post', 'draft', null, '{}'),
      ('${OTHER}', 'Other live title', 'other-post', 'published', '${FIRST_PUBLISHED}', '{}');
  `)
})

after(async () => { await db.close() })

// One transaction per test, always rolled back.
async function scenario(fn) {
  await db.exec('begin')
  try { await fn() } finally { await db.exec('rollback') }
}

// Switch the identity for the statements that follow, the way PostgREST does:
// a role plus the request's JWT claims.
async function asAnon() {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })])
  await db.exec('set local role anon')
}
async function asUser(sub, aal = 'aal2') {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal })])
  await db.exec('set local role authenticated')
}
async function asOwner() {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claims', '', true)`)
}

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

async function stage(postId, title = 'Staged title', slug = 'live-post') {
  const [r] = await rows(
    `insert into public.blog_post_staged_changes (post_id, title, slug, body)
     values ($1, $2, $3, '{"type":"doc","staged":true}') returning *`, [postId, title, slug])
  return r
}
async function setStatus(id, status) {
  const [r] = await rows(`update public.blog_post_staged_changes set review_status = $2 where id = $1 returning *`, [id, status])
  return r
}
async function publish(ids) {
  return (await rows(`select * from public.publish_staged_posts($1::uuid[]) as post_id`, [ids])).map((r) => r.post_id)
}
async function livePost(id) {
  await db.exec('savepoint peek')
  await asOwner()
  const [r] = await rows(`select * from public.blog_posts where id = $1`, [id])
  await db.exec('release savepoint peek')
  return r
}

test('migration 001 can be run again on a database that already has it', () => scenario(async () => {
  await asOwner()
  await db.exec(readFileSync(MIGRATIONS[2], 'utf8'))
  assert.equal((await rows(`select count(*)::int as n from pg_policies where tablename = 'blog_post_staged_changes'`))[0].n, 5)
}))

// ------------------------------------------------------------- the public site

test('anon has no privilege on staged changes: permission denied, not just zero rows', () => scenario(async () => {
  await asUser(ADMIN); await stage(LIVE)
  await asAnon()
  await expectError(`select * from public.blog_post_staged_changes`, [], /42501|permission denied/)
}))

test('even if anon were granted select by mistake, RLS still returns no staged rows', () => scenario(async () => {
  await asUser(ADMIN); await stage(LIVE)
  await asOwner(); await db.exec('grant select on public.blog_post_staged_changes to anon')
  await asAnon()
  assert.equal((await rows(`select * from public.blog_post_staged_changes`)).length, 0)
}))

test('anon cannot call the publish function', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE)
  await asAnon()
  // Refused at the function itself, before the table's own lock is reached.
  await expectError(`select public.publish_staged_posts($1::uuid[])`, [[s.id]], /permission denied for function/)
}))

test('anon keeps reading the live post, never the staged copy', () => scenario(async () => {
  await asUser(ADMIN); await stage(LIVE, 'Secret staged title')
  await asAnon()
  const live = await rows(`select title from public.blog_posts order by slug`)
  assert.deepEqual(live.map((r) => r.title), ['Live title', 'Other live title'])
}))

// ------------------------------------------------------------- who may read and write

test('a signed-in user with no admin role sees no staged rows and cannot stage', () => scenario(async () => {
  await asUser(ADMIN); await stage(LIVE)
  await asUser(OUTSIDER)
  assert.equal((await rows(`select * from public.blog_post_staged_changes`)).length, 0)
  await expectError(`insert into public.blog_post_staged_changes (post_id, title, slug) values ($1, 'x', 'x')`, [OTHER], /42501|row-level security/)
}))

test('a deactivated admin sees nothing and cannot stage', () => scenario(async () => {
  await asUser(ADMIN); await stage(LIVE)
  await asUser(GONE)
  assert.equal((await rows(`select * from public.blog_post_staged_changes`)).length, 0)
  await expectError(`insert into public.blog_post_staged_changes (post_id, title, slug) values ($1, 'x', 'x')`, [OTHER], /42501|row-level security/)
}))

test('two-factor: an enrolled admin on an AAL1 session can neither read nor stage', () => scenario(async () => {
  await asUser(ADMIN); await stage(LIVE)
  await asUser(SUPER, 'aal1')
  assert.equal((await rows(`select * from public.blog_post_staged_changes`)).length, 0)
  await expectError(`insert into public.blog_post_staged_changes (post_id, title, slug) values ($1, 'x', 'x')`, [OTHER], /42501|row-level security/)
  await asUser(SUPER, 'aal2')
  assert.equal((await rows(`select * from public.blog_post_staged_changes`)).length, 1)
}))

test('two-factor: an admin with no factor yet is not blocked (the enrollment deadline covers them)', () => scenario(async () => {
  await asUser(PLAIN, 'aal1')
  const s = await stage(LIVE)
  assert.equal(s.staged_by, PLAIN)
}))

test('two-factor: an enrolled admin on AAL1 cannot publish', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE)
  await asUser(SUPER, 'aal1')
  await expectError(`select * from public.publish_staged_posts($1::uuid[])`, [[s.id]], /P0002|02000|not found|could not be updated/)
  assert.equal((await livePost(LIVE)).title, 'Live title')
}))

// ------------------------------------------------------------- the review rules

test('a new staged change always starts as staged, staged by the caller, whatever the client sends', () => scenario(async () => {
  await asUser(ADMIN)
  const [s] = await rows(
    `insert into public.blog_post_staged_changes (post_id, title, slug, review_status, staged_by, approved_by, approved_at)
     values ($1, 't', 'live-post', 'approved', $2, $2, now()) returning *`, [LIVE, SUPER])
  assert.equal(s.review_status, 'staged')
  assert.equal(s.staged_by, ADMIN)
  assert.equal(s.approved_by, null)
  assert.equal(s.approved_at, null)
}))

test('one staged copy per post', () => scenario(async () => {
  await asUser(ADMIN); await stage(LIVE)
  await expectError(`insert into public.blog_post_staged_changes (post_id, title, slug) values ($1, 'again', 'live-post')`, [LIVE], /23505|duplicate/)
}))

test('request review records who asked', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE)
  await asUser(SUPER)
  const r = await setStatus(s.id, 'in_review')
  assert.equal(r.review_status, 'in_review')
  assert.equal(r.review_requested_by, SUPER)
  assert.ok(r.review_requested_at)
}))

test('nobody approves their own change; someone else can', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE); await setStatus(s.id, 'in_review')
  await expectError(`update public.blog_post_staged_changes set review_status = 'approved' where id = $1`, [s.id], /cannot approve a change you staged/)
  await asUser(SUPER)
  const r = await setStatus(s.id, 'approved')
  assert.equal(r.review_status, 'approved')
  assert.equal(r.approved_by, SUPER)
}))

test('staged cannot jump straight to approved', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE)
  await asUser(SUPER)
  await expectError(`update public.blog_post_staged_changes set review_status = 'approved' where id = $1`, [s.id], /cannot go from staged to approved/)
}))

test('editing an approved change sends it back to staged and clears the approval', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE); await setStatus(s.id, 'in_review')
  await asUser(SUPER); await setStatus(s.id, 'approved')
  const [r] = await rows(`update public.blog_post_staged_changes set title = 'Edited after approval' where id = $1 returning *`, [s.id])
  assert.equal(r.review_status, 'staged')
  assert.equal(r.staged_by, SUPER)
  assert.equal(r.approved_by, null)
  assert.equal(r.review_requested_by, null)
}))

test('editing content and approving in the same write still resets to staged', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE); await setStatus(s.id, 'in_review')
  await asUser(SUPER)
  const [r] = await rows(`update public.blog_post_staged_changes set title = 'Sneaky', review_status = 'approved' where id = $1 returning *`, [s.id])
  assert.equal(r.review_status, 'staged')
  assert.equal(r.approved_by, null)
}))

test('the bookkeeping columns cannot be written directly', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE); await setStatus(s.id, 'in_review')
  const [r] = await rows(`update public.blog_post_staged_changes set approved_by = $2, staged_by = $2 where id = $1 returning *`, [s.id, SUPER])
  assert.equal(r.approved_by, null)
  assert.equal(r.staged_by, ADMIN)
  assert.equal(r.review_status, 'in_review')
}))

test('a staged change cannot be moved to another post', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE)
  await expectError(`update public.blog_post_staged_changes set post_id = $2 where id = $1`, [s.id, OTHER], /cannot move to another post/)
}))

test('withdrawing a review request clears it', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE); await setStatus(s.id, 'in_review')
  const r = await setStatus(s.id, 'staged')
  assert.equal(r.review_status, 'staged')
  assert.equal(r.review_requested_by, null)
}))

// ------------------------------------------------------------- publishing

test('publishing copies the staged copy onto the live post, keeps its first publish date and deletes the copy', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE, 'New live title', 'live-post-renamed')
  assert.deepEqual(await publish([s.id]), [LIVE])
  const live = await livePost(LIVE)
  assert.equal(live.title, 'New live title')
  assert.equal(live.slug, 'live-post-renamed')
  assert.equal(live.status, 'published')
  assert.equal(new Date(live.published_at).toISOString(), new Date(FIRST_PUBLISHED).toISOString())
  assert.deepEqual(live.body, { type: 'doc', staged: true })
  assert.equal((await rows(`select * from public.blog_post_staged_changes`)).length, 0)
}))

test('publishing a staged draft makes it live with a publish date of now', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(DRAFT, 'Brand new post', 'brand-new-post')
  await publish([s.id])
  const live = await livePost(DRAFT)
  assert.equal(live.status, 'published')
  assert.ok(Date.now() - new Date(live.published_at).getTime() < 60_000)
  await asAnon()
  assert.equal((await rows(`select title from public.blog_posts where id = $1`, [DRAFT]))[0].title, 'Brand new post')
}))

test('a change waiting in review cannot be published, and nothing else in the batch goes live', () => scenario(async () => {
  await asUser(ADMIN)
  const a = await stage(LIVE, 'A staged', 'live-post')
  const b = await stage(OTHER, 'B in review', 'other-post'); await setStatus(b.id, 'in_review')
  await expectError(`select * from public.publish_staged_posts($1::uuid[])`, [[a.id, b.id]], /needs an approval/)
  assert.equal((await livePost(LIVE)).title, 'Live title')
  assert.equal((await livePost(OTHER)).title, 'Other live title')
}))

test('an approved change publishes', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE, 'Approved title'); await setStatus(s.id, 'in_review')
  await asUser(SUPER); await setStatus(s.id, 'approved')
  await asUser(ADMIN); await publish([s.id])
  assert.equal((await livePost(LIVE)).title, 'Approved title')
}))

test('a slug another live post already uses fails the whole batch', () => scenario(async () => {
  await asUser(ADMIN)
  const a = await stage(DRAFT, 'Fine', 'fine-slug')
  const b = await stage(LIVE, 'Clash', 'other-post')
  await expectError(`select * from public.publish_staged_posts($1::uuid[])`, [[a.id, b.id]], /23505|duplicate/)
  assert.equal((await livePost(DRAFT)).status, 'draft')
  assert.equal((await livePost(LIVE)).slug, 'live-post')
}))

test('a pick that no longer exists fails the batch', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE)
  await expectError(`select * from public.publish_staged_posts($1::uuid[])`, [[s.id, '20000000-0000-4000-8000-000000000009']], /not found/)
  assert.equal((await livePost(LIVE)).title, 'Live title')
}))

test('an empty pick is refused', () => scenario(async () => {
  await asUser(ADMIN)
  await expectError(`select * from public.publish_staged_posts($1::uuid[])`, [[]], /Pick at least one/)
}))

test('a non-admin cannot publish someone else\'s staged change', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE)
  await asUser(OUTSIDER)
  await expectError(`select * from public.publish_staged_posts($1::uuid[])`, [[s.id]], /not found/)
  assert.equal((await livePost(LIVE)).title, 'Live title')
}))

test('when review is required, only approved changes publish', () => scenario(async () => {
  await asOwner()
  await db.exec(`create or replace function public.staging_review_required() returns boolean language sql immutable set search_path = '' as $$ select true; $$`)
  await asUser(ADMIN); const s = await stage(LIVE, 'Needs a second person')
  await expectError(`select * from public.publish_staged_posts($1::uuid[])`, [[s.id]], /needs an approval/)
  await setStatus(s.id, 'in_review')
  await asUser(SUPER); await setStatus(s.id, 'approved')
  await publish([s.id])
  assert.equal((await livePost(LIVE)).title, 'Needs a second person')
}))

// ------------------------------------------------------------- discard and cascade

test('an admin can discard a staged change; the live post is untouched', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE)
  await asUser(SUPER)
  const gone = await rows(`delete from public.blog_post_staged_changes where id = $1 returning id`, [s.id])
  assert.equal(gone.length, 1)
  assert.equal((await livePost(LIVE)).title, 'Live title')
}))

test('a non-admin cannot discard a staged change', () => scenario(async () => {
  await asUser(ADMIN); const s = await stage(LIVE)
  await asUser(OUTSIDER)
  assert.equal((await rows(`delete from public.blog_post_staged_changes where id = $1 returning id`, [s.id])).length, 0)
  // With no WHERE and no RETURNING, Postgres checks only the delete policy.
  await db.query(`delete from public.blog_post_staged_changes`)
  await asUser(ADMIN)
  assert.equal((await rows(`select id from public.blog_post_staged_changes`)).length, 1)
}))

test('publishing a staged scheduled post updates its content and keeps its schedule', () => scenario(async () => {
  await asOwner()
  await db.query(`update public.blog_posts set status = 'scheduled', published_at = '2030-01-01T09:00:00+00:00' where id = $1`, [DRAFT])
  await asUser(ADMIN); const s = await stage(DRAFT, 'Fixed wording', 'draft-post')
  await publish([s.id])
  const post = await livePost(DRAFT)
  assert.equal(post.title, 'Fixed wording')
  assert.equal(post.status, 'scheduled')
  assert.equal(new Date(post.published_at).toISOString(), '2030-01-01T09:00:00.000Z')
  assert.equal((await rows(`select id from public.blog_post_staged_changes`)).length, 0)
}))

test('a change with no recorded stager cannot be approved by the person who asked for review', () => scenario(async () => {
  await asOwner()
  const [s] = await rows(`insert into public.blog_post_staged_changes (post_id, title, slug, body) values ($1, 'From a job', 'live-post', '{}') returning *`, [LIVE])
  assert.equal(s.staged_by, null)
  await asUser(ADMIN); await setStatus(s.id, 'in_review')
  await expectError(`update public.blog_post_staged_changes set review_status = 'approved' where id = $1`, [s.id], /cannot approve/)
  await asUser(SUPER)
  assert.equal((await setStatus(s.id, 'approved')).approved_by, SUPER)
}))

test('signed-in users hold only select, insert, update and delete on staged changes (no truncate)', () => scenario(async () => {
  const [p] = await rows(`select
    has_table_privilege('authenticated', 'public.blog_post_staged_changes', 'TRUNCATE') as t,
    has_table_privilege('authenticated', 'public.blog_post_staged_changes', 'REFERENCES') as r,
    has_table_privilege('authenticated', 'public.blog_post_staged_changes', 'TRIGGER') as g,
    has_table_privilege('authenticated', 'public.blog_post_staged_changes', 'SELECT,INSERT,UPDATE,DELETE') as crud`)
  assert.deepEqual(p, { t: false, r: false, g: false, crud: true })
}))

test('deleting a post deletes its staged copy', () => scenario(async () => {
  await asUser(ADMIN); await stage(LIVE)
  await db.query(`delete from public.blog_posts where id = $1`, [LIVE])
  assert.equal((await rows(`select id from public.blog_post_staged_changes`)).length, 0)
}))
