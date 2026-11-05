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

/**
 * The heading level the public renderer draws for a stored level: 1 and 2 as
 * they are, a missing level as 2, anything else (3 to 6 from an import or the
 * AI route) as 3. The renderer and the edit screen's content checks
 * (lib/admin/content-checks.ts) both use it, so a check judges the page a
 * reader gets.
 */
export function renderedHeadingLevel(level: unknown): 1 | 2 | 3 {
  const n = (level as number) || 2
  if (n === 1) return 1
  if (n === 2) return 2
  return 3
}
