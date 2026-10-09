// Database tests for migration 004: the media library. Alt text kept per
// asset (admins only), and a file a post, a staged copy or a kept revision
// still uses is never deleted by an admin, in either image bucket. Same
// engine as the other files: PGlite, one rolled-back transaction per test.
//
//   cd source/supabase/tests && npm install && npm test
//
// MEDIA_MIGRATION=<path> swaps in another copy of migration 004, which is how
// each rule below was seen failing before it passed.
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
  process.env.MEDIA_MIGRATION || here('../migrations/004_media_library.sql'),
]

const SUPER = '00000000-0000-4000-8000-000000000001' // super_admin, two-factor on
const ADMIN = '00000000-0000-4000-8000-000000000002' // admin, two-factor on
const OUTSIDER = '00000000-0000-4000-8000-000000000004' // signed in, no admin role
const LIVE = '10000000-0000-4000-8000-000000000001'
const DRAFT = '10000000-0000-4000-8000-000000000002'

const URL_OF = (path) => `https://proj.supabase.example/storage/v1/object/public/blog-images/${path}`
const ON_LIVE = 'blog/aaaaaaaa-0000-4000-8000-000000000001.png' // the live post's featured image
const IN_STAGED = 'blog/aaaaaaaa-0000-4000-8000-000000000002.webp' // in a staged copy's body
const IN_REVISION = 'blog/aaaaaaaa-0000-4000-8000-000000000003.jpg' // only in a kept revision
const UNUSED_PUBLIC = 'blog/aaaaaaaa-0000-4000-8000-000000000004.png'
const UNUSED_STAGED = 'blog/aaaaaaaa-0000-4000-8000-000000000005.gif'
const HEADSHOT = 'blog/aaaaaaaa-0000-4000-8000-000000000006.jpg' // a testimonial's headshot

let db

before(async () => {
  db = new PGlite()
  for (const file of MIGRATIONS) await db.exec(readFileSync(file, 'utf8'))
  const body = (path) => JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: URL_OF(path), alt: 'x' } }] })
  await db.exec(`
    insert into auth.users (id, email) values
      ('${SUPER}', 'super@example.com'), ('${ADMIN}', 'admin@example.com'),
      ('${OUTSIDER}', 'outsider@example.com');
    insert into auth.mfa_factors (user_id, status) values
      ('${SUPER}', 'verified'), ('${ADMIN}', 'verified');
    insert into public.user_roles (user_id, role) values
      ('${SUPER}', 'super_admin'), ('${ADMIN}', 'admin');
    insert into public.blog_posts (id, title, slug, status, published_at, body, featured_image_url, featured_image_alt) values
      ('${LIVE}', 'Live title', 'live-post', 'published', '2026-01-15T09:00:00+00:00', '{"type":"doc"}', '${URL_OF(ON_LIVE)}', 'A field'),
      ('${DRAFT}', 'Draft title', 'draft-post', 'draft', null, '{}', null, null);
    insert into public.blog_post_staged_changes (post_id, title, slug, body) values
      ('${DRAFT}', 'Draft title', 'draft-post', '${body(IN_STAGED)}');
    -- A revision that still shows an image the live post no longer uses.
    insert into public.blog_post_revisions (post_id, title, slug, body, status) values
      ('${LIVE}', 'Live title, before', 'live-post', '${body(IN_REVISION)}', 'published');
    insert into public.testimonials (kind, name, quote, headshot_url) values
      ('text', 'Sample Customer', 'It worked.', '${URL_OF(HEADSHOT)}');
    insert into storage.objects (bucket_id, name) values
      ('blog-images', '${ON_LIVE}'), ('blog-images', '${IN_REVISION}'), ('blog-images', '${UNUSED_PUBLIC}'),
      ('blog-images', '${HEADSHOT}'),
      ('blog-images-staged', '${IN_STAGED}'), ('blog-images-staged', '${UNUSED_STAGED}');
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

const deleteObject = (bucket, name) =>
  rows(`delete from storage.objects where bucket_id = $1 and name = $2 returning name`, [bucket, name])

test('migration 004 can be run again on a database that already has it', () => scenario(async () => {
  await asOwner()
  await db.exec(readFileSync(MIGRATIONS[5], 'utf8'))
  const [t] = await rows(`select to_regclass('public.blog_media') as t`)
  assert.equal(t.t, 'blog_media')
}))

// ------------------------------------------------- alt text per asset

test('alt text per asset: an admin saves it, and the database records who and when', () => scenario(async () => {
  await asUser(ADMIN)
  const [m] = await rows(`insert into public.blog_media (path, alt) values ($1, 'A wide field at dawn') returning *`, [ON_LIVE])
  assert.equal(m.uploaded_by, ADMIN)
  assert.equal(m.updated_by, ADMIN)
  await asUser(SUPER)
  const [u] = await rows(`update public.blog_media set alt = 'A wide field at first light' where path = $1 returning *`, [ON_LIVE])
  assert.equal(u.alt, 'A wide field at first light')
  assert.equal(u.uploaded_by, ADMIN)
  assert.equal(u.updated_by, SUPER)
}))

test('alt text per asset: who uploaded it and the path cannot be forged or rewritten, and nobody deletes the record by hand', () => scenario(async () => {
  await asUser(ADMIN)
  await expectError(`insert into public.blog_media (path, alt, uploaded_by) values ($1, 'x', $2)`, [ON_LIVE, SUPER], /permission denied/)
  await rows(`insert into public.blog_media (path, alt) values ($1, 'x')`, [ON_LIVE])
  await expectError(`update public.blog_media set path = $2 where path = $1`, [ON_LIVE, UNUSED_PUBLIC], /permission denied/)
  await expectError(`update public.blog_media set uploaded_by = $2 where path = $1`, [ON_LIVE, SUPER], /permission denied/)
  await expectError(`delete from public.blog_media where path = $1`, [ON_LIVE], /permission denied/)
}))

test('alt text per asset: only the kit\'s own image paths, and at most 200 characters', () => scenario(async () => {
  await asUser(ADMIN)
  await expectError(`insert into public.blog_media (path, alt) values ('../secrets.png', 'x')`, [], /23514|check/)
  await expectError(`insert into public.blog_media (path, alt) values ($1, $2)`, [UNUSED_PUBLIC, 'a'.repeat(201)], /23514|check/)
}))

test('alt text per asset: the public, a signed-in outsider and an admin without two-factor done cannot read or write it', () => scenario(async () => {
  await asOwner()
  await db.query(`insert into public.blog_media (path, alt) values ($1, 'kept')`, [ON_LIVE])
  await asAnon()
  await expectError(`select * from public.blog_media`, [], /permission denied/)
  await asUser(OUTSIDER)
  assert.equal((await rows(`select * from public.blog_media`)).length, 0)
  await expectError(`insert into public.blog_media (path, alt) values ($1, 'x')`, [UNUSED_PUBLIC], /row-level security|42501/)
  await asUser(ADMIN, 'aal1')
  assert.equal((await rows(`select * from public.blog_media`)).length, 0)
}))

// ------------------------------------------------- a used asset is never deleted

test('an admin cannot delete a public image a live post uses; an unused one goes', () => scenario(async () => {
  await asUser(ADMIN)
  assert.equal((await deleteObject('blog-images', ON_LIVE)).length, 0)
  assert.equal((await deleteObject('blog-images', UNUSED_PUBLIC)).length, 1)
}))

test('an admin cannot delete a staged image a staged change uses; an unused one goes (review off)', () => scenario(async () => {
  await asUser(ADMIN)
  assert.equal((await deleteObject('blog-images-staged', IN_STAGED)).length, 0)
  assert.equal((await deleteObject('blog-images-staged', UNUSED_STAGED)).length, 1)
}))

test('an image only a kept revision still shows counts as used, so a restore never points at a deleted file', () => scenario(async () => {
  await asUser(ADMIN)
  assert.equal((await deleteObject('blog-images', IN_REVISION)).length, 0)
}))

test('a testimonial\'s headshot counts as used too (testimonials share the image buckets)', () => scenario(async () => {
  await asUser(ADMIN)
  assert.equal((await deleteObject('blog-images', HEADSHOT)).length, 0)
}))

test('review required: a staged image stays write-once even when nothing uses it', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  assert.equal((await deleteObject('blog-images-staged', UNUSED_STAGED)).length, 0)
}))

test('the server still removes any file (the orphan cleanup and promotion run on the service role)', () => scenario(async () => {
  await asService()
  assert.equal((await deleteObject('blog-images', ON_LIVE)).length, 1)
  assert.equal((await deleteObject('blog-images-staged', IN_STAGED)).length, 1)
}))

test('the in-use check: admins and the policies can ask it, the public cannot', () => scenario(async () => {
  await asUser(ADMIN)
  const [r] = await rows(`select public.blog_image_in_use($1) as a, public.blog_image_in_use($2) as b, public.blog_image_in_use($3) as c, public.blog_image_in_use($4) as d`,
    [ON_LIVE, IN_STAGED, IN_REVISION, UNUSED_PUBLIC])
  assert.deepEqual([r.a, r.b, r.c, r.d], [true, true, true, false])
  await asAnon()
  await expectError(`select public.blog_image_in_use($1)`, [ON_LIVE], /permission denied/)
  // The stamp trigger's function is not callable by any client role either
  // (a trigger still fires: Postgres checks EXECUTE when the trigger is made).
  await asOwner()
  const [p] = await rows(`select has_function_privilege('anon', 'public.blog_media_stamp()', 'EXECUTE') as anon,
    has_function_privilege('authenticated', 'public.blog_media_stamp()', 'EXECUTE') as auth`)
  assert.deepEqual([p.anon, p.auth], [false, false])
}))

test('review required: an alt text record opens no door to the public bucket (the promotion ledger stays the only one)', () => scenario(async () => {
  await requireReview()
  await asUser(ADMIN)
  await rows(`insert into public.blog_media (path, alt) values ($1, 'planted')`, ['blog/bbbbbbbb-0000-4000-8000-000000000001.png'])
  await expectError(`insert into storage.objects (bucket_id, name) values ('blog-images', 'blog/bbbbbbbb-0000-4000-8000-000000000001.png')`, [], /42501|row-level security/)
  await expectError(`select * from public.blog_image_promotions`, [], /permission denied/)
}))
