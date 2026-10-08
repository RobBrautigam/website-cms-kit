// Route handlers, run as plain functions with stand-ins for Next.js, the
// session, Supabase and the model client (./stubs/, wired by
// resolve-hooks.mjs). Run with `npm test`.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { calls, fakes, resetStubs } from './stubs/stubs.mjs'
import { RIGHT_PASSWORD } from './stubs/reauth.mjs'

const route = (rel) => import(new URL(`../../app/api/${rel}/route.ts`, import.meta.url).href)
const SITE = 'https://cms.example.com'

function post(path, body, headers = { origin: SITE, host: 'cms.example.com' }) {
  return new Request(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(resetStubs)

test('new recovery codes: a cross-site request is refused before the session is even read', async () => {
  const { POST } = await route('admin/mfa/regenerate-codes')
  const res = await POST(post('/api/admin/mfa/regenerate-codes', { password: RIGHT_PASSWORD }, { origin: 'https://evil.example', host: 'cms.example.com' }))
  assert.equal(res.status, 403)
  assert.equal(calls.requireAdmin, 0)
  assert.equal(calls.regenerate, 0)
})

test('new recovery codes need the password: none is a 400, a wrong one a 401, and no codes are made', async () => {
  const { POST } = await route('admin/mfa/regenerate-codes')
  assert.equal((await POST(post('/api/admin/mfa/regenerate-codes', {}))).status, 400)
  assert.equal((await POST(post('/api/admin/mfa/regenerate-codes'))).status, 400)
  const wrong = await POST(post('/api/admin/mfa/regenerate-codes', { password: 'guess' }))
  assert.equal(wrong.status, 401)
  assert.equal(calls.regenerate, 0)
  assert.deepEqual(calls.audit, [])
})

test('new recovery codes with the right password: the codes come back and the action is audited', async () => {
  const { POST } = await route('admin/mfa/regenerate-codes')
  const res = await POST(post('/api/admin/mfa/regenerate-codes', { password: RIGHT_PASSWORD }))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { recovery_codes: ['aaaa-bbbb', 'cccc-dddd'] })
  assert.deepEqual(calls.audit, ['auth.mfa.regenerated_codes'])
})

test('turning two-factor off still needs the password', async () => {
  const { POST } = await route('admin/mfa/disable')
  const res = await POST(post('/api/admin/mfa/disable', { factor_id: 'f1', password: 'guess' }))
  assert.equal(res.status, 401)
  assert.deepEqual(calls.passwords, ['guess'])
})

test('AI titles: over the limit is a 429 and the model is never called', async () => {
  const { POST } = await route('ai/suggest-title')
  fakes.aiAllowed = false
  const res = await POST(post('/api/ai/suggest-title', { excerpt: 'x', currentTitle: 'y' }))
  assert.equal(res.status, 429)
  assert.ok(res.headers.get('Retry-After'))
  assert.equal(calls.anthropic, 0)
})

test('AI titles: a limiter that is down pauses AI calls (503), it does not wave them through', async () => {
  const { POST } = await route('ai/suggest-title')
  fakes.aiAllowed = new Error('function consume_rate_limit does not exist')
  const res = await POST(post('/api/ai/suggest-title', { excerpt: 'x' }))
  assert.equal(res.status, 503)
  assert.equal(calls.anthropic, 0)
})

test('AI titles: a reply in the wrong shape is a 502; the right shape comes through', async () => {
  const { POST } = await route('ai/suggest-title')
  fakes.modelText = 'Here are three great titles!'
  assert.equal((await POST(post('/api/ai/suggest-title', { excerpt: 'x' }))).status, 502)
  fakes.modelText = '{"titles": ["a"]}'
  assert.equal((await POST(post('/api/ai/suggest-title', { excerpt: 'x' }))).status, 502)
  fakes.modelText = '["One", "Two", "Three"]'
  const ok = await POST(post('/api/ai/suggest-title', { excerpt: 'x' }))
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { titles: ['One', 'Two', 'Three'] })
})

test('AI titles: an oversized input is refused before the model is called', async () => {
  const { POST } = await route('ai/suggest-title')
  const res = await POST(post('/api/ai/suggest-title', { excerpt: 'x'.repeat(2001) }))
  assert.equal(res.status, 400)
  assert.equal(calls.anthropic, 0)
})

test('AI meta: only a {metaDescription} reply comes through', async () => {
  const { POST } = await route('ai/suggest-meta')
  fakes.modelText = '{"description": "x"}'
  assert.equal((await POST(post('/api/ai/suggest-meta', { title: 'T' }))).status, 502)
  fakes.modelText = '{"metaDescription": "Plan once, water less."}'
  const ok = await POST(post('/api/ai/suggest-meta', { title: 'T' }))
  assert.deepEqual(await ok.json(), { metaDescription: 'Plan once, water less.' })
})

test('AI post: a body with a node the site does not draw is a 502, never handed to the editor', async () => {
  const { POST } = await route('ai/generate')
  const reply = {
    title: 'T', slug: 't', excerpt: 'e', metaDescription: 'm', suggestedCategories: [],
    body: { type: 'doc', content: [{ type: 'iframe', attrs: { src: 'https://evil.example' } }] },
  }
  fakes.modelText = JSON.stringify(reply)
  assert.equal((await POST(post('/api/ai/generate', { topic: 'gardens' }))).status, 502)
  reply.body.content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }]
  fakes.modelText = JSON.stringify(reply)
  assert.equal((await POST(post('/api/ai/generate', { topic: 'gardens' }))).status, 200)
})

test('AI routes share one per-admin budget: every route spends from it', async () => {
  fakes.aiAllowed = false
  for (const [rel, body] of [['ai/generate', { topic: 'x' }], ['ai/suggest-meta', { title: 'T' }], ['ai/suggest-title', {}]]) {
    const { POST } = await route(rel)
    assert.equal((await POST(post(`/api/${rel}`, body))).status, 429, rel)
  }
  assert.equal(calls.anthropic, 0)
})

test('the redirect beacon counts through the limited function on the service role, keyed by the visitor', async () => {
  const { POST } = await route('redirects/hit/[id]')
  const sent = []
  const realFetch = globalThis.fetch
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.example'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-value'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-value'
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init })
    return new Response(null, { status: 200 })
  }
  try {
    const id = '30000000-0000-4000-8000-000000000001'
    const req = new Request(`${SITE}/api/redirects/hit/${id}`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.2', 'user-agent': 'Mozilla/5.0' },
    })
    const res = await POST(req, { params: Promise.resolve({ id }) })
    assert.equal(res.status, 204)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].url, 'https://proj.supabase.example/rest/v1/rpc/record_redirect_hit')
    assert.equal(sent[0].init.headers.apikey, 'service-role-test-value')
    const body = JSON.parse(sent[0].init.body)
    assert.equal(body.redirect_id, id)
    assert.equal(body.caller_key, '203.0.113.9')
    assert.ok(body.per_caller_max > 0 && body.per_redirect_max >= body.per_caller_max)
    // Without the service role key nothing is counted: the anon key never reaches the counter.
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const again = new Request(`${SITE}/api/redirects/hit/${id}`, { method: 'POST' })
    assert.equal((await POST(again, { params: Promise.resolve({ id }) })).status, 204)
    assert.equal(sent.length, 1)
  } finally {
    globalThis.fetch = realFetch
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  }
})

// Private staged images: publishing copies each one to the public bucket.
const IMG = (path) => `https://proj.supabase.example/storage/v1/object/public/blog-images/${path}`
const A = 'blog/0a1b2c3d4e5f.png'
const B = 'blog/11112222-3333-4444-5555-666677778888.webp'

test('going live makes the post\'s staged images public and clears the staged copies', async () => {
  const { promoteImages } = await import('../../lib/staging/promote-images.ts')
  fakes.storage.staged.add(A)
  fakes.storage.staged.add(B)
  const failed = await promoteImages({
    featured_image_url: IMG(A),
    body: { type: 'doc', content: [{ type: 'image', attrs: { src: IMG(B), alt: 'x' } }] },
  })
  assert.equal(failed, null)
  assert.deepEqual([...fakes.storage.public].sort(), [A, B].sort())
  assert.equal(fakes.storage.staged.size, 0)
})

test('an image already public (or from before 1.3.0) is skipped; a real storage failure stops the publish', async () => {
  const { promoteImages } = await import('../../lib/staging/promote-images.ts')
  fakes.storage.public.add(A)
  assert.equal(await promoteImages({ featured_image_url: IMG(A) }), null)
  fakes.storage.staged.add(B)
  fakes.storage.failCopy = 'Service unavailable'
  assert.match(await promoteImages({ featured_image_url: IMG(B) }), /could not be made public/)
  assert.equal(fakes.storage.public.has(B), false)
})
