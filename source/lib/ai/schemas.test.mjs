// The AI routes' input caps and output schemas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GenerateInput, GeneratedPost, MetaInput, MetaSuggestion, TitleSuggestions, parseModelJson } from './schemas.ts'

const doc = (content) => ({ type: 'doc', content })
const post = (overrides = {}) => ({
  title: 'A post',
  slug: 'a-post',
  excerpt: 'Short.',
  metaDescription: 'Meta.',
  suggestedCategories: ['news'],
  body: doc([{ type: 'paragraph', content: [{ type: 'text', text: 'Hi', marks: [{ type: 'bold' }] }] }]),
  ...overrides,
})

test('three titles parse, with or without a code fence', () => {
  const r = parseModelJson('```json\n["One", "Two", "Three"]\n```', TitleSuggestions)
  assert.deepEqual(r, { ok: true, data: ['One', 'Two', 'Three'] })
})

test('a reply that is not JSON, or not the promised shape, is refused', () => {
  assert.equal(parseModelJson('Sure! Here are some titles:', TitleSuggestions).ok, false)
  assert.equal(parseModelJson('{"titles": ["One"]}', TitleSuggestions).ok, false)
  assert.equal(parseModelJson('[]', TitleSuggestions).ok, false)
  assert.equal(parseModelJson(JSON.stringify(['x'.repeat(201)]), TitleSuggestions).ok, false)
  assert.equal(parseModelJson('{"metaDescription": ""}', MetaSuggestion).ok, false)
  assert.equal(parseModelJson('{"meta": "x"}', MetaSuggestion).ok, false)
  assert.deepEqual(parseModelJson('{"metaDescription": " Good. "}', MetaSuggestion), { ok: true, data: { metaDescription: 'Good.' } })
})

test('a generated post parses when its body holds only what the site draws', () => {
  assert.equal(parseModelJson(JSON.stringify(post()), GeneratedPost).ok, true)
})

test('a generated post is refused for a bad slug, an unknown node, an unknown mark or a missing body', () => {
  assert.equal(parseModelJson(JSON.stringify(post({ slug: 'Not A Slug' })), GeneratedPost).ok, false)
  assert.equal(parseModelJson(JSON.stringify(post({ body: doc([{ type: 'iframe', attrs: { src: 'https://evil.example' } }]) })), GeneratedPost).ok, false)
  assert.equal(
    parseModelJson(JSON.stringify(post({ body: doc([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }] }]) })), GeneratedPost).ok,
    false
  )
  assert.equal(parseModelJson(JSON.stringify(post({ body: undefined })), GeneratedPost).ok, false)
  assert.equal(parseModelJson(JSON.stringify(post({ body: { type: 'paragraph', content: [] } })), GeneratedPost).ok, false)
})

test('inputs are capped so one request cannot buy an outsized prompt', () => {
  assert.equal(GenerateInput.safeParse({ topic: '' }).success, false)
  assert.equal(GenerateInput.safeParse({ topic: 'x'.repeat(501) }).success, false)
  assert.equal(GenerateInput.safeParse({ topic: 'ok', keywords: Array(21).fill('k') }).success, false)
  assert.deepEqual(GenerateInput.parse({ topic: ' ok ' }), { topic: 'ok', keywords: [] })
  assert.equal(MetaInput.safeParse({ title: '' }).success, false)
  assert.equal(MetaInput.safeParse({ title: 'T', excerpt: 'x'.repeat(2001) }).success, false)
})
