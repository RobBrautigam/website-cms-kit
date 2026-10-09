/**
 * Private staged images.
 *
 * An admin's upload goes to the private `blog-images-staged` bucket
 * (migration 002, section 18), under the same path it will have in the
 * public `blog-images` bucket. The post's content stores the final public
 * URL from the start, so an approved change and the live post hold the
 * same text and the two-person lock's exact match still works. Until the
 * post goes live that URL does not resolve yet; the admin screens show the
 * image through a short-lived signed link instead, and publishing copies the
 * file to the public bucket (lib/staging/promote-images.ts).
 */

export const PUBLIC_BUCKET = 'blog-images'
export const STAGED_BUCKET = 'blog-images-staged'

// The kit's own upload names only (lib/admin/upload-image.ts newImagePath).
const PATH = /\/storage\/v1\/object\/public\/blog-images\/(blog\/[A-Za-z0-9-]{8,64}\.(?:jpg|png|webp|gif))(?:[?#].*)?$/

/** The storage path behind a public blog-images URL, or null. */
export function imagePathFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = PATH.exec(url)
  return m ? m[1] : null
}

/** A storage path the kit could have made itself (used by the server routes). */
export function isImagePath(path: unknown): path is string {
  return typeof path === 'string' && /^blog\/[A-Za-z0-9-]{8,64}\.(?:jpg|png|webp|gif)$/.test(path)
}

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[] }

/** Every kit image path in a post's content: the featured image and the body. */
export function imagePathsIn(content: { featured_image_url?: unknown; body?: unknown }): string[] {
  const paths = new Set<string>()
  const add = (url: unknown) => {
    const p = imagePathFromUrl(url)
    if (p) paths.add(p)
  }
  add(content.featured_image_url)
  const walk = (node: Node | undefined) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'image') add(node.attrs?.src)
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(content.body as Node)
  return [...paths]
}

/** The kit image paths a testimonial holds (its pictures share the post buckets). */
export function imagePathsInTestimonial(row: {
  headshot_url?: unknown
  screenshot_url?: unknown
  video_thumbnail_url?: unknown
}): string[] {
  const paths = [row.headshot_url, row.screenshot_url, row.video_thumbnail_url].map(imagePathFromUrl)
  return [...new Set(paths.filter((p): p is string => p !== null))]
}

/**
 * A copy of the content with image URLs swapped through `signed` (path to
 * signed URL). Used by the draft-mode preview; the stored content is never
 * changed.
 */
export function withSignedImages<T extends { featured_image_url?: string | null; body?: unknown }>(
  content: T,
  signed: Record<string, string>
): T {
  const swap = (url: unknown) => {
    const p = imagePathFromUrl(url)
    return p && signed[p] ? signed[p] : url
  }
  const walk = (node: Node): Node => {
    if (!node || typeof node !== 'object') return node
    const next: Node = { ...node }
    if (node.type === 'image' && node.attrs) next.attrs = { ...node.attrs, src: swap(node.attrs.src) }
    if (Array.isArray(node.content)) next.content = node.content.map(walk)
    return next
  }
  return {
    ...content,
    featured_image_url: swap(content.featured_image_url) as string | null | undefined,
    body: content.body && typeof content.body === 'object' ? walk(content.body as Node) : content.body,
  }
}

/** The admin-only route that redirects to a signed link for a staged image. */
export function stagedImageFallback(url: unknown): string | null {
  const p = imagePathFromUrl(url)
  return p ? `/api/admin/staged-image?path=${encodeURIComponent(p)}` : null
}
