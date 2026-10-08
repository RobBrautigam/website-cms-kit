// Server reads for the staging screens: the editor, the posts list and the
// staging page. Every read uses the signed-in admin's own cookie session, so
// RLS (active admin, two-factor once enrolled) decides what comes back.
// Model: docs/10-staging-and-approval.md.
import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { BlogPost, BlogPostStagedChange } from '@/lib/supabase/types'
import type { ReviewStatus } from './rules'

export type StagedChangeWithPost = BlogPostStagedChange & {
  post: Pick<BlogPost, 'id' | 'title' | 'slug' | 'status' | 'published_at' | 'excerpt' | 'body' | 'categories' | 'meta_description' | 'featured_image_url' | 'featured_image_alt' | 'author_slug'> | null
}

/** The staged copy of one post, or null when the post has none. */
export async function getStagedChange(postId: string): Promise<BlogPostStagedChange | null> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('blog_post_staged_changes')
    .select('*')
    .eq('post_id', postId)
    .maybeSingle()
  if (error) {
    console.error('[staging] read failed', error.message)
    return null
  }
  return (data as BlogPostStagedChange | null) ?? null
}

/** post id -> review status, for the Staged badge on the posts list. */
export async function getStagedStatusByPost(): Promise<Record<string, ReviewStatus>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('blog_post_staged_changes')
    .select('post_id, review_status')
  if (error || !data) return {}
  return Object.fromEntries(data.map((r) => [r.post_id as string, r.review_status as ReviewStatus]))
}

/** Every staged change with the live post it would replace, oldest first. */
export async function listStagedChanges(): Promise<StagedChangeWithPost[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('blog_post_staged_changes')
    .select(
      '*, post:blog_posts(id, title, slug, status, published_at, excerpt, body, categories, meta_description, featured_image_url, featured_image_alt, author_slug)'
    )
    .order('staged_at', { ascending: true })
  if (error) {
    console.error('[staging] list failed', error.message)
    return []
  }
  return (data ?? []) as unknown as StagedChangeWithPost[]
}
