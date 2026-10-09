// Cleaning up staged images nothing uses (lib/staging/orphans.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ORPHAN_MIN_AGE_HOURS, planOrphanCleanup } from './orphans.ts'

const NOW = new Date('2026-10-08T12:00:00Z')
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600_000).toISOString()

test('an unreferenced staged image older than the grace period is removed; a referenced or recent one is kept', () => {
  const objects = [
    { name: 'oldorphan1.png', created_at: hoursAgo(72) },
    { name: 'inuse00001.png', created_at: hoursAgo(72) },
    { name: 'justuploaded.png', created_at: hoursAgo(1) },
    { name: 'stagedcopy1.webp', created_at: hoursAgo(500) },
  ]
  const referenced = ['blog/inuse00001.png', 'blog/stagedcopy1.webp']
  assert.deepEqual(planOrphanCleanup(objects, referenced, NOW), ['blog/oldorphan1.png'])
})

test('the grace period is at least a day, so an upload waiting for its first save is safe', () => {
  assert.ok(ORPHAN_MIN_AGE_HOURS >= 24)
  const objects = [{ name: 'editing123.png', created_at: hoursAgo(ORPHAN_MIN_AGE_HOURS - 1) }]
  assert.deepEqual(planOrphanCleanup(objects, [], NOW), [])
})

test('only names the kit makes are ever removed; folders, odd names and missing dates are left alone', () => {
  const objects = [
    { name: '.emptyFolderPlaceholder', created_at: hoursAgo(900) },
    { name: 'nested', created_at: null },
    { name: 'not-an-image.txt', created_at: hoursAgo(900) },
    { name: 'nodate00001.png', created_at: null },
    { name: 'x.png', created_at: hoursAgo(900) },
  ]
  assert.deepEqual(planOrphanCleanup(objects, [], NOW), [])
})
