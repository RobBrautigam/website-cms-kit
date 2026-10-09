/**
 * What the public renderer (components/TipTapRenderer.tsx) draws. The editor
 * may only offer what is listed here, or a writer sees formatting in the
 * editor that vanishes on the site; the AI route's output schema accepts only
 * these types too. Tests hold all three to this list.
 */
export const RENDERED_NODES = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'image',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
] as const

export const RENDERED_MARKS = ['bold', 'italic', 'strike', 'code', 'link'] as const

export type RenderedNode = (typeof RENDERED_NODES)[number]
export type RenderedMark = (typeof RENDERED_MARKS)[number]
