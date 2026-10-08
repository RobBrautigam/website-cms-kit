// Security headers and the Content Security Policy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SECURITY_HEADERS, buildCsp, cspEnforced, cspHeaderName, newNonce } from './headers.ts'
import nextConfig from '../../next.config.ts'

const header = (key) => SECURITY_HEADERS.find((h) => h.key === key)?.value

test('next.config.ts sends the fixed security headers on every path', async () => {
  const rules = await nextConfig.headers()
  assert.equal(rules.length, 1)
  assert.equal(rules[0].source, '/:path*')
  assert.equal(rules[0].headers, SECURITY_HEADERS)
  assert.equal(nextConfig.poweredByHeader, false)
})

test('the fixed headers: HTTPS only, no sniffing, no framing, a strict referrer, no powerful features', () => {
  assert.match(header('Strict-Transport-Security'), /max-age=63072000/)
  assert.equal(header('X-Content-Type-Options'), 'nosniff')
  assert.equal(header('X-Frame-Options'), 'DENY')
  assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin')
  assert.match(header('Permissions-Policy'), /camera=\(\)/)
  assert.equal(header('Cross-Origin-Opener-Policy'), 'same-origin')
})

test('the policy reports only unless CSP_MODE=enforce', () => {
  assert.equal(cspEnforced(undefined), false)
  assert.equal(cspEnforced('report-only'), false)
  assert.equal(cspEnforced('enforce'), true)
  assert.equal(cspHeaderName(false), 'Content-Security-Policy-Report-Only')
  assert.equal(cspHeaderName(true), 'Content-Security-Policy')
})

const directive = (csp, name) => csp.split('; ').find((d) => d === name || d.startsWith(name + ' '))

test('scripts need this request\'s nonce; Supabase is allowed for images, the API and Realtime', () => {
  const csp = buildCsp({ nonce: 'abc123', supabaseUrl: 'https://proj.supabase.co' })
  assert.equal(directive(csp, 'script-src'), "script-src 'self' 'nonce-abc123' 'strict-dynamic'")
  assert.equal(directive(csp, 'connect-src'), "connect-src 'self' https://proj.supabase.co wss://proj.supabase.co")
  assert.equal(directive(csp, 'img-src'), "img-src 'self' blob: data: https://proj.supabase.co")
  assert.equal(directive(csp, 'object-src'), "object-src 'none'")
  assert.equal(directive(csp, 'base-uri'), "base-uri 'self'")
  assert.equal(directive(csp, 'form-action'), "form-action 'self'")
  assert.doesNotMatch(csp, /unsafe-eval/)
})

test('a report-only policy leaves out the two directives browsers ignore there; an enforced one has them', () => {
  const reportOnly = buildCsp({ nonce: 'n' })
  assert.equal(directive(reportOnly, 'frame-ancestors'), undefined)
  assert.equal(directive(reportOnly, 'upgrade-insecure-requests'), undefined)
  const enforced = buildCsp({ nonce: 'n', enforce: true })
  assert.equal(directive(enforced, 'frame-ancestors'), "frame-ancestors 'none'")
  assert.equal(directive(enforced, 'upgrade-insecure-requests'), 'upgrade-insecure-requests')
})

test('dev mode allows eval and a local Supabase over plain HTTP; a report URI is passed through', () => {
  const csp = buildCsp({ nonce: 'n', dev: true, supabaseUrl: 'http://127.0.0.1:54321', reportUri: '/csp-reports' })
  assert.match(directive(csp, 'script-src'), /'unsafe-eval'/)
  assert.equal(directive(csp, 'connect-src'), "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321")
  assert.equal(directive(csp, 'report-uri'), 'report-uri /csp-reports')
})

test('every request gets a fresh 128-bit nonce', () => {
  const a = newNonce()
  const b = newNonce()
  assert.notEqual(a, b)
  assert.equal(Buffer.from(a, 'base64').length, 16)
})

test('the per-request policy covers /admin by default and the whole site only on request', async () => {
  const { cspFor, forwardWithCsp } = await import('./csp.ts')
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' }
  const admin = cspFor('/admin/posts', env)
  assert.equal(admin.name, 'Content-Security-Policy-Report-Only')
  assert.ok(admin.value.includes(`'nonce-${admin.nonce}'`))
  assert.equal(cspFor('/admin', env).name, 'Content-Security-Policy-Report-Only')
  assert.equal(cspFor('/blog/a-post', env), null)
  assert.equal(cspFor('/administrator', env), null)
  assert.ok(cspFor('/blog/a-post', { ...env, CSP_SCOPE: 'site' }))
  assert.equal(cspFor('/admin', { ...env, CSP_MODE: 'enforce' }).name, 'Content-Security-Policy')
  const fwd = forwardWithCsp(new Headers({ cookie: 'a=b' }), admin)
  assert.equal(fwd.get('cookie'), 'a=b')
  assert.equal(fwd.get('content-security-policy-report-only'), admin.value)
  assert.equal(fwd.get('x-nonce'), admin.nonce)
  assert.equal(forwardWithCsp(new Headers({ a: '1' }), null).get('x-nonce'), null)
})
