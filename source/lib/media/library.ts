/**
 * The media library (1.5.0): every image file the kit holds, in either
 * bucket, with what the promotion ledger says about it and which posts use
 * it. Pure functions, so the rules are tested without a server; the server
 * side that lists the buckets is lib/media/load.ts, the actions are
 * app/(admin)/admin/media/actions.ts, and the database rules are migration
 * 004 (docs/13-media-library.md).
 *
 *   - private: uploaded, waiting in the private staged bucket for its post to
 *     go live (review sees it through a signed link);
 *   - public: in the public bucket, made public by the kit (the ledger has
 *     its row);
 *   - not promoted: in the public bucket with no ledger row: uploaded
 *     straight to it (before 1.3.0, or by hand in the Supabase dashboard), so
 *     it never went through review here. Shown so an admin can check it and
 *     take it down; promotion refuses to adopt it.
 */

import { imagePathsIn, imagePathsInTestimonial, isImagePath } from '@/lib/staging/images'

export const MEDIA_ALT_MAX = 200
export const MEDIA_PAGE_SIZE = 48

export type MediaUseKind = 'post' | 'staged' | 'revision' | 'testimonial'
export type MediaUse = { kind: MediaUseKind; postId: string; title: string }
export type MediaState = 'private' | 'public' | 'not_promoted'

export type MediaAsset = {
  path: string
  state: MediaState
  /** A staged copy still sits beside the public file (a promotion whose clean-up failed). */
  leftoverStagedCopy: boolean
  promotedAt: string | null
  promotedForPostId: string | null
  alt: string
  createdAt: string | null
  size: number | null
  uses: MediaUse[]
  /** Why an admin cannot delete it, or null when they can. */
  deleteRefusal: string | null
}

export type StorageObject = { name: string; created_at?: string | null; metadata?: { size?: number } | null }
export type ContentRow = {
  post_id?: string | null
  id?: string | null
  title?: string | null
  featured_image_url?: unknown
  body?: unknown
}
export type TestimonialRow = {
  id?: string | null
  name?: string | null
  headshot_url?: unknown
  screenshot_url?: unknown
  video_thumbnail_url?: unknown
}

/** Alt text as stored: trimmed, no control characters, at most 200 characters. */
export function cleanAlt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length <= MEDIA_ALT_MAX ? text : null
}

/**
 * Which posts (and testimonials) use each image path, from the places
 * content lives. One entry per kind and owner, however many revisions hold it.
 */
export function usesByPath(sources: {
  posts: ContentRow[]
  staged: ContentRow[]
  revisions: ContentRow[]
  testimonials?: TestimonialRow[]
}): Map<string, MediaUse[]> {
  const out = new Map<string, MediaUse[]>()
  const record = (kind: MediaUseKind, postId: string, title: string, paths: string[]) => {
    for (const path of paths) {
      const list = out.get(path) ?? []
      if (!list.some((u) => u.kind === kind && u.postId === postId)) list.push({ kind, postId, title })
      out.set(path, list)
    }
  }
  const add = (kind: MediaUseKind, rows: ContentRow[], idOf: (r: ContentRow) => string | null | undefined) => {
    for (const row of rows) {
      const postId = idOf(row)
      if (postId) record(kind, postId, String(row.title ?? ''), imagePathsIn(row))
    }
  }
  add('post', sources.posts, (r) => r.id)
  add('staged', sources.staged, (r) => r.post_id)
  add('revision', sources.revisions, (r) => r.post_id)
  for (const t of sources.testimonials ?? []) {
    if (t.id) record('testimonial', t.id, String(t.name ?? ''), imagePathsInTestimonial(t))
  }
  return out
}

/** The reason a delete is refused, or null. Mirrors migration 004's policies. */
export function mediaDeleteRefusal(uses: MediaUse[]): string | null {
  if (uses.length === 0) return null
  const live = uses.filter((u) => u.kind === 'post').length
  const staged = uses.filter((u) => u.kind === 'staged').length
  const kept = uses.filter((u) => u.kind === 'revision').length
  const quotes = uses.filter((u) => u.kind === 'testimonial').length
  const parts = [
    live && `${live} post${live === 1 ? '' : 's'}`,
    staged && `${staged} staged change${staged === 1 ? '' : 's'}`,
    kept && `${kept} post${kept === 1 ? "'s" : "s'"} kept revisions`,
    quotes && `${quotes} testimonial${quotes === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return `In use by ${parts.join(', ')}. Remove it from them first; a used image is never deleted.`
}

const pathOf = (o: StorageObject) => (o.name.startsWith('blog/') ? o.name : `blog/${o.name}`)

/** Both buckets' files, one asset per path, newest first. */
export function buildMediaLibrary(input: {
  staged: StorageObject[]
  public: StorageObject[]
  promotions: { path: string; post_id: string | null; promoted_at: string | null }[]
  alts: { path: string; alt: string }[]
  uses: Map<string, MediaUse[]>
}): MediaAsset[] {
  const ledger = new Map(input.promotions.map((p) => [p.path, p]))
  const alts = new Map(input.alts.map((a) => [a.path, a.alt]))
  const staged = new Map<string, StorageObject>()
  for (const o of input.staged) if (isImagePath(pathOf(o))) staged.set(pathOf(o), o)
  const assets = new Map<string, MediaAsset>()
  const make = (path: string, o: StorageObject, state: MediaState): MediaAsset => {
    const uses = input.uses.get(path) ?? []
    const row = ledger.get(path)
    return {
      path,
      state,
      leftoverStagedCopy: false,
      promotedAt: row?.promoted_at ?? null,
      promotedForPostId: row?.post_id ?? null,
      alt: alts.get(path) ?? '',
      createdAt: o.created_at ?? null,
      size: typeof o.metadata?.size === 'number' ? o.metadata.size : null,
      uses,
      deleteRefusal: mediaDeleteRefusal(uses),
    }
  }
  for (const o of input.public) {
    const path = pathOf(o)
    if (!isImagePath(path)) continue
    const state: MediaState = ledger.has(path) ? 'public' : 'not_promoted'
    const asset = make(path, o, state)
    asset.leftoverStagedCopy = staged.has(path)
    assets.set(path, asset)
  }
  for (const [path, o] of staged) {
    if (!assets.has(path)) assets.set(path, make(path, o, 'private'))
  }
  return [...assets.values()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.path.localeCompare(b.path))
}

export type MediaFilter = 'all' | 'private' | 'public' | 'unused' | 'missing_alt'

export function filterMedia(assets: MediaAsset[], filter: MediaFilter): MediaAsset[] {
  switch (filter) {
    case 'private':
      return assets.filter((a) => a.state === 'private')
    case 'public':
      return assets.filter((a) => a.state !== 'private')
    case 'unused':
      return assets.filter((a) => a.uses.length === 0)
    case 'missing_alt':
      return assets.filter((a) => !a.alt.trim())
    default:
      return assets
  }
}
