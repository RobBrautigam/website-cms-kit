// The same-site check for state-changing routes. Run with `npm test` in
// source/supabase/tests (which registers the module resolver).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crossSiteRefusal, isSameOriginPost, publicOrigin, siteOriginOf } from './request-origin.ts'

test('only a request from a page on this site counts as same-site', () => {
  const site = 'https://site.example'
  assert.equal(isSameOriginPost('https://site.example', null, site), true)
  assert.equal(isSameOriginPost(null, 'same-origin', site), true)
  assert.equal(isSameOriginPost('https://evil.example', null, site), false)
  assert.equal(isSameOriginPost('https://site.example.evil.example', null, site), false)
  assert.equal(isSameOriginPost('null', null, site), false)
  // An opaque origin falls back to the browser-set Sec-Fetch-Site header.
  assert.equal(isSameOriginPost('null', 'same-origin', site), true)
  assert.equal(isSameOriginPost(null, 'cross-site', site), false)
  assert.equal(isSameOriginPost(null, 'same-site', site), false)
  assert.equal(isSameOriginPost(null, null, site), false)
})

test('behind a proxy, the site origin comes from the forwarded host, not the server bind address', () => {
  const internal = 'http://localhost:3000/api/admin/preview'
  assert.equal(publicOrigin('cms.example.com', 'https', 'localhost:3000', internal), 'https://cms.example.com')
  assert.equal(publicOrigin('cms.example.com, proxy.internal', 'https, http', null, internal), 'https://cms.example.com')
  assert.equal(publicOrigin('cms.example.com', null, null, internal), 'https://cms.example.com')
  assert.equal(publicOrigin(null, null, 'cms.example.com', internal), 'http://cms.example.com')
  assert.equal(publicOrigin(null, null, null, 'https://site.example/api/admin/preview'), 'https://site.example')
})

const req = (headers, url = 'http://localhost:3000/api/admin/mfa/disable') =>
  new Request(url, { method: 'POST', headers })

test('a cross-site POST gets a 403 before anything else runs', async () => {
  for (const headers of [
    { origin: 'https://evil.example', host: 'cms.example.com' },
    { 'sec-fetch-site': 'cross-site', host: 'cms.example.com' },
    { host: 'cms.example.com' },
    { origin: 'null', host: 'cms.example.com' },
  ]) {
    const res = crossSiteRefusal(req(headers))
    assert.ok(res, JSON.stringify(headers))
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'Cross-site request refused.' })
  }
})

test('a POST from a page on this site passes, also behind a proxy', () => {
  assert.equal(crossSiteRefusal(req({ origin: 'http://localhost:3000' })), null)
  assert.equal(crossSiteRefusal(req({ 'sec-fetch-site': 'same-origin' })), null)
  assert.equal(
    crossSiteRefusal(req({ origin: 'https://cms.example.com', 'x-forwarded-host': 'cms.example.com', 'x-forwarded-proto': 'https' })),
    null
  )
  assert.equal(siteOriginOf(req({ 'x-forwarded-host': 'cms.example.com' })), 'https://cms.example.com')
})

// Every route handler that changes something on a cookie session calls the
// check first. The exceptions: the redirect beacon (public, no session, only
// bumps a rate-limited counter) and the scheduler's job (no cookie at all:
// a bearer secret, checked first by cronRefusal).
const API = fileURLToPath(new URL('../../app/api/', import.meta.url))
const PUBLIC_BEACONS = new Set(['redirects/hit/[id]/route.ts'])
const BEARER_ONLY = new Set(['cron/scheduled-publishing/route.ts'])

function routes(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return routes(p)
    return name === 'route.ts' ? [p] : []
  })
}

test('every state-changing cookie route runs the same-site check before its auth check', () => {
  const checked = []
  for (const file of routes(API)) {
    const rel = relative(API, file).replaceAll('\\', '/')
    const src = readFileSync(file, 'utf8')
    const handlers = [...src.matchAll(/export async function (POST|PUT|PATCH|DELETE)\b/g)]
    if (handlers.length === 0 || PUBLIC_BEACONS.has(rel)) continue
    if (BEARER_ONLY.has(rel)) {
      for (const h of handlers) {
        const body = src.slice(h.index)
        const check = body.search(/cronRefusal\(/)
        const work = body.search(/createServiceClient\(|createServerSupabaseClient\(|cookies\(/)
        assert.ok(check > 0 && (work === -1 || check < work), `${rel} ${h[1]} must run cronRefusal() first`)
        assert.ok(!/cookies\(|createServerSupabaseClient\(/.test(src), `${rel} must not read a cookie session`)
      }
      continue
    }
    for (const h of handlers) {
      const body = src.slice(h.index)
      const check = body.search(/crossSiteRefusal\(/)
      const auth = body.search(/await require[A-Za-z]*\(|draftMode\(/)
      assert.ok(check > 0, `${rel} ${h[1]} has no crossSiteRefusal()`)
      assert.ok(auth === -1 || check < auth, `${rel} ${h[1]} checks auth before the same-site check`)
    }
    checked.push(rel)
  }
  // 17 older handlers plus the two preview routes.
  assert.equal(checked.length, 19, checked.join('\n'))
})
