/**
 * Checks on a post's body and address that search engines and screen readers
 * read, shown beside the search and share previews on the edit screen. They
 * warn and never block: alt text is the one rule that refuses going live
 * (lib/admin/alt-text.ts), and its count is repeated here so a writer sees it
 * before pressing the button.
 *
 * 1. The post's title is the page's one H1, so the body has none.
 * 2. Headings go down one level at a time: an H3 needs an H2 above it.
 * 3. Every heading has text.
 * 4. A link's text says where it goes: not "click here", "read more" or the
 *    bare address.
 * 5. Every image in the body has alt text.
 * 6. The slug is lowercase letters and digits joined by single hyphens.
 *
 * Heading levels are judged as the public renderer draws them
 * (renderedHeadingLevel in lib/tiptap/schema.ts): a stored H4 from an import
 * is drawn as an H3, so it is judged as one. Model: docs/14.
 */

import { bodyImagesMissingAlt } from './alt-text'
import { renderedHeadingLevel } from '../tiptap/schema'

type Mark = { type?: string; attrs?: Record<string, unknown> }
type Node = { type?: string; text?: string; marks?: Mark[]; attrs?: Record<string, unknown>; content?: Node[] }

export type ContentCheckInput = {
  body?: unknown
  slug?: string | null
}

/** A slug the public proxy and the redirect rules can match (docs/14). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Link text that says nothing about where the link goes, compared after
 * lowercasing, trimming and dropping trailing punctuation and arrows.
 */
export const VAGUE_LINK_TEXT = new Set([
  'click',
  'click here',
  'continue',
  'continue reading',
  'find out more',
  'go',
  'here',
  'learn more',
  'link',
  'more',
  'read more',
  'see more',
  'this',
  'this article',
  'this link',
  'this page',
  'this post',
])

const BARE_ADDRESS = /^(https?:\/\/|www\.)\S+$/i

function plainText(node: Node | undefined): string {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  return Array.isArray(node.content) ? node.content.map(plainText).join('') : ''
}

function linkHref(node: Node): string | null {
  if (node.type !== 'text' || !Array.isArray(node.marks)) return null
  const link = node.marks.find((m) => m && m.type === 'link')
  if (!link) return null
  return typeof link.attrs?.href === 'string' ? link.attrs.href : ''
}

/**
 * Every link in the body, with its address and its text. Neighboring text
 * nodes that carry the same link are read as one link, as a reader sees it
 * ("read **more**" is split by the bold mark).
 */
export function bodyLinks(body: unknown): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = []
  const walk = (node: Node | undefined) => {
    if (!node || typeof node !== 'object' || !Array.isArray(node.content)) return
    const runs: Array<{ href: string; text: string }> = []
    let open = false // the last child was a link, so a same-link neighbor joins it
    for (const child of node.content) {
      const href = child && typeof child === 'object' ? linkHref(child) : null
      if (href === null) {
        open = false
        walk(child)
        continue
      }
      const text = typeof child.text === 'string' ? child.text : ''
      const last = runs[runs.length - 1]
      if (open && last && last.href === href) last.text += text
      else runs.push({ href, text })
      open = true
    }
    for (const r of runs) out.push(r)
  }
  walk(body as Node)
  return out
}

/** Every link's text, in the order of bodyLinks(). */
export function linkTexts(body: unknown): string[] {
  return bodyLinks(body).map((l) => l.text)
}

/**
 * The body's headings in document order: `level` is the level the page draws;
 * `inEditor` is the level the editor shows, which offers only H2 and H3 and
 * shows any other stored level (an H1 or H4 from an import) as an H2.
 */
export function bodyHeadings(body: unknown): Array<{ level: 1 | 2 | 3; inEditor: 2 | 3; text: string }> {
  const out: Array<{ level: 1 | 2 | 3; inEditor: 2 | 3; text: string }> = []
  const walk = (node: Node | undefined) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'heading') {
      out.push({
        level: renderedHeadingLevel(node.attrs?.level),
        inEditor: node.attrs?.level === 3 ? 3 : 2,
        text: plainText(node).trim().replace(/\s+/g, ' '),
      })
      return
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(body as Node)
  return out
}

const quote = (text: string) => `"${text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text}"`

function vague(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’(«‹←→<>-]+/u, '')
    .replace(/[\s"'“”‘’).,:;!?…»›→>-]+$/u, '')
  return VAGUE_LINK_TEXT.has(t)
}

/** An address with its scheme, a leading www. and a trailing slash dropped. */
function bareAddress(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
}

/** The link's text is its own address, or reads as one (http:// or www.). */
function showsAddress(link: { href: string; text: string }): boolean {
  if (BARE_ADDRESS.test(link.text)) return true
  return link.href.trim() !== '' && bareAddress(link.text) === bareAddress(link.href)
}

/**
 * A slug from a title or a typed slug: lowercase letters and digits joined by
 * single hyphens, at most 96 characters, cut before the ends are trimmed so a
 * long title never leaves a trailing hyphen. The edit screen's slug field
 * uses it, so a slug the editor makes always passes SLUG_PATTERN.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 96)
    .replace(/^-+|-+$/g, '')
}

function list(items: string[]): string {
  const shown = items.slice(0, 3)
  const rest = items.length - shown.length
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ')
}

/** The warnings for the edit screen; an empty list when the post passes. */
export function contentChecks({ body, slug }: ContentCheckInput): string[] {
  const warnings: string[] = []
  const headings = bodyHeadings(body)

  const h1s = headings.filter((h) => h.level === 1)
  const h1Names = h1s.filter((h) => h.text).map((h) => quote(h.text))
  const named = h1Names.length ? ` (${list(h1Names)})` : ''
  if (h1s.length === 1) warnings.push(`The body has an H1${named}, shown as an H2 in the editor. The post title is the page's one H1; select the heading and press H2.`)
  if (h1s.length > 1) warnings.push(`The body has ${h1s.length} H1 headings${named}, shown as H2 in the editor. The post title is the page's one H1; select each and press H2.`)

  const skipped: Array<{ name: string; inEditor: 2 | 3 }> = []
  let previous = 1 // the post title
  for (const h of headings) {
    if (h.level > previous + 1 && h.text) skipped.push({ name: quote(h.text), inEditor: h.inEditor })
    previous = h.level
  }
  // A stored H4 to H6 is drawn as an H3 but shown as an H2 in the editor.
  const shownAsH2 = skipped.some((s) => s.inEditor === 2) ? ' The editor shows a heading stored deeper than H3 as an H2; press H3 on it to set its level.' : ''
  if (skipped.length === 1) warnings.push(`The heading ${skipped[0].name} is drawn as an H3 with no H2 above it. Headings are read as an outline; go down one level at a time.${shownAsH2}`)
  if (skipped.length > 1) warnings.push(`${skipped.length} headings are drawn as H3 with no H2 above them (${list(skipped.map((s) => s.name))}). Headings are read as an outline; go down one level at a time.${shownAsH2}`)

  const empty = headings.filter((h) => !h.text).length
  if (empty === 1) warnings.push('1 heading has no text.')
  if (empty > 1) warnings.push(`${empty} headings have no text.`)

  const links = bodyLinks(body).map((l) => ({ href: l.href, text: l.text.trim().replace(/\s+/g, ' ') }))
  const blankLinks = links.filter((l) => !l.text).length
  const vagueLinks = links.filter((l) => l.text && vague(l.text)).map((l) => l.text)
  const addressLinks = links.filter((l) => l.text && !vague(l.text) && showsAddress(l))
  if (blankLinks > 0) warnings.push(blankLinks === 1 ? '1 link has no text.' : `${blankLinks} links have no text.`)
  if (vagueLinks.length > 0) {
    const names = [...new Set(vagueLinks.map(quote))]
    warnings.push(`${vagueLinks.length === 1 ? '1 link says' : `${vagueLinks.length} links say`} ${list(names)}. Link text should say where it goes; screen readers list links on their own.`)
  }
  if (addressLinks.length > 0) {
    warnings.push(`${addressLinks.length === 1 ? '1 link shows' : `${addressLinks.length} links show`} a bare address as its text. Name the page it goes to instead.`)
  }

  const missingAlt = bodyImagesMissingAlt(body)
  if (missingAlt === 1) warnings.push('1 image in the post has no alt text; it is needed before the post goes live.')
  if (missingAlt > 1) warnings.push(`${missingAlt} images in the post have no alt text; it is needed before the post goes live.`)

  const s = (slug ?? '').trim()
  if (!s) warnings.push('Add a slug: it is the post\'s address.')
  else if (!SLUG_PATTERN.test(s)) warnings.push('The slug should be lowercase letters and digits joined by single hyphens, like dry-summer-garden.')

  return warnings
}
