/**
 * Alt text is required before anything goes live: on the featured image and
 * on every image in the body. Drafts can be saved without it; publishing,
 * scheduling and staging for review cannot. The server actions run this
 * check too, so it is not only a browser prompt.
 */

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[] }

export type AltTextInput = {
  featuredImageUrl?: string | null
  featuredImageAlt?: string | null
  body?: unknown
}

const blank = (v: unknown) => typeof v !== 'string' || v.trim() === ''

/** How many images in a TipTap body have no alt text. */
export function bodyImagesMissingAlt(body: unknown): number {
  let missing = 0
  const walk = (node: Node | undefined) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'image' && blank(node.attrs?.alt)) missing++
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(body as Node)
  return missing
}

/** Null when every image has alt text; otherwise the message to show. */
export function altTextRefusal({ featuredImageUrl, featuredImageAlt, body }: AltTextInput): string | null {
  const parts: string[] = []
  if (!blank(featuredImageUrl) && blank(featuredImageAlt)) parts.push('the featured image')
  const inBody = bodyImagesMissingAlt(body)
  if (inBody === 1) parts.push('1 image in the post')
  if (inBody > 1) parts.push(`${inBody} images in the post`)
  if (parts.length === 0) return null
  return `Add alt text before this goes live: ${parts.join(' and ')}. Alt text is what screen readers say and what shows if the image fails to load.`
}
