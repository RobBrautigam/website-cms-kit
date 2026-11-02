// Database tests for migration 005: a live post's old address redirects to its
// new one, one hop, never away from a live post. Same engine as the other
// files: PGlite, one rolled-back transaction per test. The trigger is deferred
// to the end of the transaction, so each test runs `set constraints all
// immediate` where a real request would commit.
//
// ADDRESS_MIGRATION=<path> swaps in another copy of migration 005, which is
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
  here('../migrations/003_revisions_and_scheduling.sql'),
  here('../migrations/004_media_library.sql'),
  process.env.ADDRESS_MIGRATION || here('../migrations/005_post_address_redirects.sql'),
]

const SUPER = '00000000-0000-4000-8000-000000000001'
const ADMIN = '00000000-0000-4000-8000-000000000002'
const LIVE = '10000000-0000-4000-8000-000000000001' // /blog/live-post
const DRAFT = '10000000-0000-4000-8000-000000000002' // /blog/draft-post
const OTHER = '10000000-0000-4000-8000-000000000003' // /blog/other-post, live
const ENDED = '10000000-0000-4000-8000-000000000004' // /blog/ended-post, past its end date

let db

before(async () => {
  db = new PGlite()
  for (const file of MIGRATIONS) await db.exec(readFileSync(file, 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${SUPER}', 'super@example.com'), ('${ADMIN}', 'admin@example.com');
    insert into auth.mfa_factors (user_id, status) values ('${SUPER}', 'verified'), ('${ADMIN}', 'verified');
    insert into public.user_roles (user_id, role) values ('${SUPER}', 'super_admin'), ('${ADMIN}', 'admin');
    insert into public.blog_posts (id, title, slug, status, published_at, unpublish_at, body) values
      ('${LIVE}', 'Live', 'live-post', 'published', '2026-01-15T09:00:00+00:00', null, '{"type":"doc"}'),
      ('${DRAFT}', 'Draft', 'draft-post', 'draft', null, null, '{}'),
      ('${OTHER}', 'Other', 'other-post', 'published', '2026-01-10T09:00:00+00:00', null, '{}'),
      ('${ENDED}', 'Ended', 'ended-post', 'published', '2026-01-01T09:00:00+00:00', now() - interval '1 day', '{}');
    insert into public.url_redirects (source, is_pattern, destination) values
      ('/spring-campaign', false, '/blog/live-post'),
      ('/blog/:slug/amp', true, '/blog/live-post');
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
const asUser = (sub, aal = 'aal2') => as('authenticated', { sub, role: 'authenticated', aal })
const asOwner = () => as(null, null)
async function rows(sql, params) { return (await db.query(sql, params)).rows }
// What a commit would do: run the deferred trigger now.
const commitPoint = () => db.exec('set constraints all immediate')
async function redirects() {
  await asOwner()
  return rows(`select source, destination, permanent, enabled, category, changed_by, is_pattern from public.url_redirects order by source`)
}
const bySource = (list, source) => list.find((r) => r.source === source)
async function stage(postId, title, slug) {
  const [r] = await rows(
    `insert into public.blog_post_staged_changes (post_id, title, slug, body)
     values ($1, $2, $3, '{"type":"doc"}') returning *`, [postId, title, slug])
  return r
}
const setStatus = (id, status) => rows(`update public.blog_post_staged_changes set review_status = $2 where id = $1`, [id, status])

test('a live post published at a new address leaves a permanent redirect from the old one, and an audit row', () => scenario(async () => {
  await asUser(ADMIN)
  const s = await stage(LIVE, 'Live, renamed', 'live-post-renamed')
  await rows(`select public.publish_staged_posts($1)`, [[s.id]])
  await commitPoint()
  const r = bySource(await redirects(), '/blog/live-post')
  assert.deepEqual(
    { destination: r.destination, permanent: r.permanent, enabled: r.enabled, category: r.category, changed_by: r.changed_by, is_pattern: r.is_pattern },
    { destination: '/blog/live-post-renamed', permanent: true, enabled: true, category: 'post-slug-change', changed_by: ADMIN, is_pattern: false })
  const [a] = await rows(`select action, actor_user_id, payload from public.admin_audit_log where action = 'redirect.post_address_changed'`)
  assert.equal(a.actor_user_id, ADMIN)
  assert.deepEqual(a.payload, { from: '/blog/live-post', to: '/blog/live-post-renamed', redirect_created: true, repointed: 1, switched_off: 0 })
}))

test('no chains: a static redirect to the old address now points at the new one; a pattern is left alone', () => scenario(async () => {
  await asOwner()
  await rows(`update public.blog_posts set slug = 'live-post-renamed' where id = $1`, [LIVE])
  await commitPoint()
  const list = await redirects()
  assert.equal(bySource(list, '/spring-campaign').destination, '/blog/live-post-renamed')
  assert.equal(bySource(list, '/blog/:slug/amp').destination, '/blog/live-post')
}))

test('renamed back: the redirect away from the live address is switched off, and the other address points home', () => scenario(async () => {
  await asOwner()
  await rows(`update public.blog_posts set slug = 'second-name' where id = $1`, [LIVE])
  await commitPoint()
  await rows(`update public.blog_posts set slug = 'live-post' where id = $1`, [LIVE])
  await commitPoint()
  const list = await redirects()
  assert.equal(bySource(list, '/blog/live-post').enabled, false)
  assert.equal(bySource(list, '/blog/second-name').destination, '/blog/live-post')
  assert.equal(bySource(list, '/blog/second-name').enabled, true)
  assert.equal(bySource(list, '/spring-campaign').destination, '/blog/live-post')
  const live = list.filter((r) => r.enabled && ['/blog/live-post', '/blog/other-post'].includes(r.source))
  assert.deepEqual(live, [])
}))

test('renamed twice in one transaction: the first address points straight at the last', () => scenario(async () => {
  await asOwner()
  await rows(`update public.blog_posts set slug = 'second-name' where id = $1`, [LIVE])
  await rows(`update public.blog_posts set slug = 'third-name' where id = $1`, [LIVE])
  await commitPoint()
  const list = await redirects()
  assert.equal(bySource(list, '/blog/live-post').destination, '/blog/third-name')
  assert.equal(bySource(list, '/spring-campaign').destination, '/blog/third-name')
}))

test('a draft, an ended post, or a post taken down in the same change gets no redirect', () => scenario(async () => {
  await asOwner()
  await rows(`update public.blog_posts set slug = 'draft-renamed' where id = $1`, [DRAFT])
  await rows(`update public.blog_posts set slug = 'ended-renamed' where id = $1`, [ENDED])
  await rows(`update public.blog_posts set slug = 'gone', status = 'draft' where id = $1`, [OTHER])
  await commitPoint()
  const sources = (await redirects()).map((r) => r.source)
  for (const s of ['/blog/draft-post', '/blog/ended-post', '/blog/other-post']) assert.equal(sources.includes(s), false, s)
}))

test('a draft renamed and published in one change: its draft address was never public, so no redirect', () => scenario(async () => {
  await asOwner()
  await rows(`update public.blog_posts set slug = 'draft-launched', status = 'published', published_at = now() where id = $1`, [DRAFT])
  await commitPoint()
  const sources = (await redirects()).map((r) => r.source)
  assert.equal(sources.includes('/blog/draft-post'), false)
}))

test('two live posts swapping addresses in one publish: no redirect from either live address', () => scenario(async () => {
  await asUser(ADMIN)
  const a = await stage(LIVE, 'Live', 'other-post')
  const b = await stage(OTHER, 'Other', 'live-post')
  await rows(`select public.publish_staged_posts($1)`, [[a.id, b.id]])
  await commitPoint()
  const list = await redirects()
  assert.equal(list.some((r) => r.enabled && (r.source === '/blog/live-post' || r.source === '/blog/other-post')), false)
  const [a2] = await rows(`select count(*)::int as n from public.admin_audit_log where action = 'redirect.post_address_changed' and (payload->>'redirect_created')::boolean = false`)
  assert.equal(a2.n, 2)
}))

test('review required: the approved rename still leaves its redirect switched on', () => scenario(async () => {
  await asOwner()
  await db.exec(`create or replace function public.staging_review_required() returns boolean language sql immutable set search_path = '' as $$ select true; $$`)
  await asUser(ADMIN)
  const s = await stage(LIVE, 'Live, renamed', 'live-post-renamed')
  await setStatus(s.id, 'in_review')
  await asUser(SUPER)
  await setStatus(s.id, 'approved')
  await rows(`select public.publish_staged_posts($1)`, [[s.id]])
  await commitPoint()
  const r = bySource(await redirects(), '/blog/live-post')
  assert.equal(r.enabled, true)
  assert.equal(r.changed_by, SUPER)
}))

test('the helpers match the public read policy, and clients cannot call the trigger function', () => scenario(async () => {
  await asOwner()
  const [h] = await rows(`select public.blog_post_path('a-b') as p,
    public.blog_post_is_live('published', null, null) as pub,
    public.blog_post_is_live('scheduled', now() + interval '1 hour', null) as later,
    public.blog_post_is_live('scheduled', now() - interval '1 hour', null) as due,
    public.blog_post_is_live('published', null, now() - interval '1 second') as ended,
    public.blog_post_is_live('draft', null, null) as draft`)
  assert.deepEqual(h, { p: '/blog/a-b', pub: true, later: false, due: true, ended: false, draft: false })
  const [g] = await rows(`select has_function_privilege('authenticated', 'public.blog_posts_keep_old_address()', 'execute') as auth,
    has_function_privilege('anon', 'public.blog_posts_keep_old_address()', 'execute') as anon`)
  assert.deepEqual(g, { auth: false, anon: false })
}))

test('migration 005 can be run again on a database that already has it', () => scenario(async () => {
  await asOwner()
  await db.exec(readFileSync(MIGRATIONS[6], 'utf8'))
  const [t] = await rows(`select count(*)::int as n from pg_trigger where tgname = 'blog_posts_keep_old_address'`)
  assert.equal(t.n, 1)
}))
