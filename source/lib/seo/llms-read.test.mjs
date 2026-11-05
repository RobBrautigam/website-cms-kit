// /llms.txt reads only the fields it prints and lets a database error through,
// so a failed regeneration keeps the last good file (Next.js ISR, "Handling
// uncaught exceptions") instead of caching a map with no posts for an hour.
// The route and the read are checked in their source, as schema.test.mjs does
// for the renderer: the data layer needs a live Supabase client to run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`)
  assert.ok(start >= 0, `${name} not found`)
  const next = source.indexOf('\nexport ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('llms.txt read: the fields it prints, live posts only, and it throws on a database error', () => {
  const body = functionBody(read('../data.ts'), 'getLlmsTxtEntries')
  assert.ok(body.includes(".select('slug,title,excerpt,status,published_at,unpublish_at')"), 'a narrow select')
  assert.ok(!body.includes("select('*')"), 'never every column')
  assert.ok(body.includes('status.eq.published,and(status.eq.scheduled,published_at.lte.'), 'live posts only')
  assert.ok(body.includes('if (error) throw error'), 'a database error is thrown')
  assert.ok(!body.includes('catch'), 'and not swallowed')
})

test('llms.txt route: uses the narrow read and does not catch its error', () => {
  const route = read('../../app/llms.txt/route.ts')
  const code = route
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
  assert.ok(code.includes('await getLlmsTxtEntries()'), 'the narrow read')
  assert.ok(!code.includes('getBlogPosts'), 'not the read that swallows errors')
  assert.ok(!code.includes('catch'), 'no catch around the read')
  assert.ok(code.includes('export const revalidate = 3600'), 'still regenerated hourly')
})
