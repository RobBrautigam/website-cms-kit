// 1.6.0: the redirect manager refuses a loop (app/(admin)/admin/redirects/actions.ts
// with lib/redirects/chains.ts), with the stand-ins in ./stubs/.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { calls, fakes, resetStubs } from './stubs/stubs.mjs'

const actions = () => import(new URL('../../app/(admin)/admin/redirects/actions.ts', import.meta.url).href)
const form = (fields) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const rule = (id, source, destination, extra = {}) => ({ id, source, destination, enabled: true, is_pattern: false, permanent: true, ...extra })

beforeEach(() => {
  resetStubs()
  fakes.tables.url_redirects = [rule('r1', '/b', '/c'), rule('r2', '/c', '/a'), rule('r3', '/x', '/y', { enabled: false }), rule('r4', '/y', '/x')]
})

test('creating a redirect that closes a loop is refused before anything is written', async () => {
  const { createRedirect } = await actions()
  const r = await createRedirect({ ok: true }, form({ source: '/a', destination: '/b', permanent: 'true', enabled: 'on' }))
  assert.equal(r.ok, false)
  assert.match(r.error, /loop: \/a -> \/b -> \/c -> \/a/)
  assert.equal(fakes.tables.url_redirects.length, 4)
  assert.deepEqual(calls.audit, [])
})

test('a redirect saved switched off, or one that only makes a chain, is saved', async () => {
  const { createRedirect } = await actions()
  let r = await createRedirect({ ok: true }, form({ source: '/a', destination: '/b', permanent: 'true' }))
  assert.equal(r.ok, true)
  r = await createRedirect({ ok: true }, form({ source: '/z', destination: '/b', permanent: 'true', enabled: 'on' }))
  assert.equal(r.ok, true)
  assert.equal(fakes.tables.url_redirects.length, 6)
})

test('editing a redirect into a loop is refused; editing it out of one is allowed', async () => {
  const { updateRedirect } = await actions()
  fakes.tables.url_redirects.push(rule('r5', '/a', '/elsewhere'))
  let r = await updateRedirect('r5', { ok: true }, form({ source: '/a', destination: '/b', permanent: 'true', enabled: 'on' }))
  assert.equal(r.ok, false)
  assert.match(r.error, /loop/)
  assert.equal(fakes.tables.url_redirects.find((x) => x.id === 'r5').destination, '/elsewhere')
  r = await updateRedirect('r2', { ok: true }, form({ source: '/c', destination: '/d', permanent: 'true', enabled: 'on' }))
  assert.equal(r.ok, true)
})

test('an edit that moves a redirect out of a loop is checked against the other rows, not its old self', async () => {
  const { updateRedirect } = await actions()
  // /a -> /b -> /c -> /a is a loop already (made before 1.6.0); moving r2 from /c to /d breaks it.
  fakes.tables.url_redirects.push(rule('r5', '/a', '/b'))
  const r = await updateRedirect('r2', { ok: true }, form({ source: '/d', destination: '/a', permanent: 'true', enabled: 'on' }))
  assert.equal(r.ok, true)
  assert.equal(fakes.tables.url_redirects.find((x) => x.id === 'r2').source, '/d')
})

test('switching on a redirect that would close a loop is refused; switching one off is always allowed', async () => {
  const { toggleRedirectEnabled } = await actions()
  let r = await toggleRedirectEnabled('r3', true)
  assert.equal(r.ok, false)
  assert.match(r.error, /loop: \/x -> \/y -> \/x/)
  assert.equal(fakes.tables.url_redirects.find((x) => x.id === 'r3').enabled, false)
  r = await toggleRedirectEnabled('r1', false)
  assert.equal(r.ok, true)
})

test('every switched-on redirect is checked, past the Data API\'s 1,000-row cap', async () => {
  const { createRedirect } = await actions()
  fakes.honorRange = true
  fakes.tables.url_redirects = Array.from({ length: 1500 }, (_, i) => rule(`r${i}`, `/old-${i}`, `/new-${i}`))
  fakes.tables.url_redirects[1200] = rule('r1200', '/b', '/a')
  const r = await createRedirect({ ok: true }, form({ source: '/a', destination: '/b', permanent: 'true', enabled: 'on' }))
  assert.equal(r.ok, false)
  assert.match(r.error, /loop: \/a -> \/b -> \/a/)
})

test('a redirect to this site\'s own absolute address cannot hide a loop', async () => {
  const { createRedirect } = await actions()
  const before = process.env.NEXT_PUBLIC_SITE_URL
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.example.com'
  try {
    const r = await createRedirect({ ok: true }, form({ source: '/a', destination: 'https://www.example.com/b', permanent: 'true', enabled: 'on' }))
    assert.equal(r.ok, false)
    assert.match(r.error, /loop/)
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = before
  }
})

test('if the other redirects cannot be read, the save is refused (the check fails closed)', async () => {
  const { createRedirect } = await actions()
  fakes.failSelect.url_redirects = 'connection reset'
  const r = await createRedirect({ ok: true }, form({ source: '/q', destination: '/r', permanent: 'true', enabled: 'on' }))
  assert.equal(r.ok, false)
  assert.match(r.error, /Could not check/)
  assert.equal(r.error.includes('connection reset'), false)
})
