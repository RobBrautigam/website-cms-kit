// The pure half of the rate limits (the database half is in
// source/supabase/tests/hardening.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RATE_LIMITS, aiLimitRefusal, clientAddress, tooManyRequests } from './rate-limit.ts'

test('the caller is the first forwarded address, then X-Real-IP, then "unknown"', () => {
  assert.equal(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7')
  assert.equal(clientAddress(new Headers({ 'x-real-ip': ' 198.51.100.2 ' })), '198.51.100.2')
  assert.equal(clientAddress(new Headers()), 'unknown')
  assert.equal(clientAddress(new Headers({ 'x-forwarded-for': 'x'.repeat(500) })).length, 64)
})

test('a refusal is a 429 that says when to come back', async () => {
  const res = tooManyRequests(600)
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('Retry-After'), '600')
  assert.match((await res.json()).error, /Too many requests/)
})

test('an AI call goes ahead under the limit, is refused over it, and pauses when the limiter is down', async () => {
  assert.equal(await aiLimitRefusal(async () => true), null)
  const over = await aiLimitRefusal(async () => false)
  assert.equal(over.status, 429)
  assert.equal(over.headers.get('Retry-After'), String(RATE_LIMITS.ai.windowSeconds))
  const down = await aiLimitRefusal(async () => { throw new Error('function consume_rate_limit does not exist') })
  assert.equal(down.status, 503)
  assert.match((await down.json()).error, /migration 002/)
})

test('the limits are small enough to cap a runaway bill and the redirect counter', () => {
  assert.ok(RATE_LIMITS.ai.max <= 60)
  assert.ok(RATE_LIMITS.redirectHit.perCaller <= 10)
  assert.ok(RATE_LIMITS.redirectHit.perRedirect >= RATE_LIMITS.redirectHit.perCaller)
})
