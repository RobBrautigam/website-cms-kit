// Redirect chains and loops (docs/14).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { destinationPath, findRedirectProblems, follow, loopRefusal } from './chains.ts'

const r = (source, destination, extra = {}) => ({ source, destination, enabled: true, is_pattern: false, ...extra })

test('a destination path is compared in the stored form; another site is not followed', () => {
  assert.equal(destinationPath('/b/'), '/b')
  assert.equal(destinationPath('/b?x=1#top'), '/b')
  assert.equal(destinationPath('/'), '/')
  assert.equal(destinationPath('https://other.example/b'), null)
  assert.equal(destinationPath('//other.example/b'), null)
})

test('follow: every hop to the end, an outside address ends it, a loop is caught', () => {
  assert.deepEqual(follow('/a', [r('/a', '/b'), r('/b', '/c')]), { hops: ['/a', '/b', '/c'], loop: false })
  assert.deepEqual(follow('/a', [r('/a', '/b'), r('/b', 'https://other.example/x')]), { hops: ['/a', '/b', 'https://other.example/x'], loop: false })
  assert.equal(follow('/a', [r('/a', '/b'), r('/b', '/a')]).loop, true)
  assert.deepEqual(follow('/a', [r('/a', '/b'), r('/b', '/c', { enabled: false })]).hops, ['/a', '/b'])
  assert.deepEqual(follow('/a', [r('/a', '/b'), r('/b', '/c', { is_pattern: true })]).hops, ['/a', '/b'])
})

test('problems: a chain with its one-hop fix, a loop listed once, single hops left alone', () => {
  const rules = [r('/old', '/older/'), r('/older', '/new'), r('/fine', '/new'), r('/x', '/y'), r('/y', '/x')]
  const { chains, loops } = findRedirectProblems(rules)
  assert.deepEqual(chains, [{ source: '/old', hops: ['/old', '/older', '/new'], fixTo: '/new' }])
  assert.equal(loops.length, 1)
  assert.deepEqual([...loops[0]].sort(), ['/x', '/x', '/y'].sort())
})

test('a save that would loop is refused; a chain is not a loop; an edit replaces its own row', () => {
  const existing = [r('/b', '/c', { id: '2' }), r('/c', '/a', { id: '3' })]
  assert.match(loopRefusal(r('/a', '/b'), existing), /loop: \/a -> \/b -> \/c -> \/a/)
  assert.match(loopRefusal(r('/a', '/a/'), []), /its own address/)
  assert.equal(loopRefusal(r('/a', '/b'), [r('/b', '/c')]), null)
  assert.equal(loopRefusal(r('/a', '/b', { enabled: false }), existing), null)
  // A switched-off row is never refused; it is checked when it is switched on.
  assert.equal(loopRefusal(r('/a', '/a/', { enabled: false }), []), null)
  assert.equal(loopRefusal(r('/a/:x', '/b', { is_pattern: true }), existing), null)
  // Editing /c (id 3) to point elsewhere removes the loop the old row made.
  assert.equal(loopRefusal(r('/c', '/d', { id: '3' }), [...existing, r('/a', '/b', { id: '1' })]), null)
  // An edit that moves the source: the old row (matched by id) is gone too.
  assert.equal(loopRefusal(r('/d', '/a', { id: '3' }), [...existing, r('/a', '/b', { id: '1' })]), null)
})
