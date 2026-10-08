// The editor offers only what the site draws.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RENDERED_MARKS, RENDERED_NODES } from './schema.ts'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const renderer = read('../../components/TipTapRenderer.tsx')
const editor = read('../../components/admin/PostEditor.tsx')

// TipTap 3's StarterKit, by its configure() key and the content type it adds
// (tiptap.dev/docs/editor/extensions/functionality/starterkit, read 2026-10-08).
// Dropcursor, Gapcursor, ListKeymap, TrailingNode and UndoRedo add no content.
const STARTER_KIT = {
  blockquote: 'blockquote',
  bold: 'bold',
  bulletList: 'bulletList',
  code: 'code',
  codeBlock: 'codeBlock',
  document: 'doc',
  hardBreak: 'hardBreak',
  heading: 'heading',
  horizontalRule: 'horizontalRule',
  italic: 'italic',
  link: 'link',
  listItem: 'listItem',
  orderedList: 'orderedList',
  paragraph: 'paragraph',
  strike: 'strike',
  text: 'text',
  underline: 'underline',
}

test('the renderer has a case for every node and mark on the list', () => {
  for (const type of [...RENDERED_NODES, ...RENDERED_MARKS]) {
    if (type === 'text') continue // drawn by the text branch before the switch
    assert.match(renderer, new RegExp(`case '${type}'`), `TipTapRenderer.tsx does not draw "${type}"`)
  }
})

test('everything StarterKit adds is either drawn by the site or switched off in the editor', () => {
  const rendered = new Set([...RENDERED_NODES, ...RENDERED_MARKS])
  for (const [key, type] of Object.entries(STARTER_KIT)) {
    const off = new RegExp(`\\b${key}: false`).test(editor)
    assert.ok(rendered.has(type) || off, `StarterKit's ${key} is on in the editor but the site does not draw "${type}"`)
  }
})

test('strike, inline code, code blocks and horizontal rules are drawn (they were silently dropped before 1.3.0)', () => {
  for (const type of ['strike', 'code', 'codeBlock', 'horizontalRule']) {
    assert.ok(RENDERED_NODES.includes(type) || RENDERED_MARKS.includes(type), type)
  }
})
