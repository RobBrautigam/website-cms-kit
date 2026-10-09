import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { PUBLIC_BUCKET, STAGED_BUCKET } from '@/lib/staging/images'
import { buildMediaLibrary, usesByPath, type ContentRow, type MediaAsset, type StorageObject, type TestimonialRow } from './library'

const PAGE = 1000

/**
 * Everything the media library shows, read on the service role after the
 * caller's own admin check: both buckets' files, the promotion ledger, the
 * alt text per asset, and every post, staged copy, kept revision and
 * testimonial that could use a file (lib/media/library.ts turns it into one
 * list). With `uses: false` (the editor's picker) it skips the content
 * tables, so opening the picker never reads every post body and revision.
 */
export async function loadMediaLibrary(
  { uses = true }: { uses?: boolean } = {}
): Promise<{ assets: MediaAsset[] } | { error: string }> {
  const svc = createServiceClient()

  const listAll = async (bucket: string): Promise<StorageObject[] | string> => {
    const out: StorageObject[] = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await svc.storage
        .from(bucket)
        .list('blog', { limit: PAGE, offset, sortBy: { column: 'created_at', order: 'desc' } })
      if (error) return `Could not list ${bucket}: ${error.message}`
      for (const o of data ?? []) {
        out.push({ name: o.name, created_at: o.created_at ?? null, metadata: (o.metadata as { size?: number }) ?? null })
      }
      if (!data || data.length < PAGE) break
    }
    return out
  }

  const readAll = async <T>(table: string, columns: string): Promise<T[] | string> => {
    const out: T[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await svc
        .from(table)
        .select(columns)
        .range(from, from + PAGE - 1)
      if (error) return `Could not read ${table}: ${error.message}`
      out.push(...((data ?? []) as T[]))
      if (!data || data.length < PAGE) break
    }
    return out
  }

  const [staged, pub, promotions, alts, posts, stagedRows, revisions, testimonials] = await Promise.all([
    listAll(STAGED_BUCKET),
    listAll(PUBLIC_BUCKET),
    readAll<{ path: string; post_id: string | null; promoted_at: string | null }>(
      'blog_image_promotions',
      'path, post_id, promoted_at'
    ),
    readAll<{ path: string; alt: string }>('blog_media', 'path, alt'),
    uses ? readAll<ContentRow>('blog_posts', 'id, title, featured_image_url, body') : [],
    uses ? readAll<ContentRow>('blog_post_staged_changes', 'post_id, title, featured_image_url, body') : [],
    uses ? readAll<ContentRow>('blog_post_revisions', 'post_id, title, featured_image_url, body') : [],
    uses ? readAll<TestimonialRow>('testimonials', 'id, name, headshot_url, screenshot_url, video_thumbnail_url') : [],
  ])
  for (const part of [staged, pub, promotions, alts, posts, stagedRows, revisions, testimonials]) {
    if (typeof part === 'string') {
      return { error: /blog_media/.test(part) ? `${part}. Check that migration 004 has run.` : part }
    }
  }
  return {
    assets: buildMediaLibrary({
      staged: staged as StorageObject[],
      public: pub as StorageObject[],
      promotions: promotions as { path: string; post_id: string | null; promoted_at: string | null }[],
      alts: alts as { path: string; alt: string }[],
      uses: usesByPath({
        posts: posts as ContentRow[],
        staged: stagedRows as ContentRow[],
        revisions: revisions as ContentRow[],
        testimonials: testimonials as TestimonialRow[],
      }),
    }),
  }
}
