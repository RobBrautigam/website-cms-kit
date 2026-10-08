// Draft-mode preview reads: your real pages with every staged change laid
// over the live posts. Admin-only, three times over:
//   1. draft mode must be on (the cookie only the preview route sets)
//   2. the visitor must be an active admin, on AAL2 once they have a factor
//   3. staged rows are read with the visitor's own session, so RLS decides
// Draft mode alone is a cache switch, not a login: a copied cookie in another
// browser fails check 2 and gets the live site. The public data layer
// (lib/data.ts) never reads staged rows. Model: docs/10-staging-and-approval.md.
import 'server-only'
import { draftMode } from 'next/headers'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getAdminRoleOrNull } from '@/lib/auth/require'
import { mapPost } from '@/lib/data'
import type { BlogPost, BlogPostStagedChange } from '@/lib/supabase/types'
import { STAGED_CONTENT_FIELDS } from './rules'

async function previewClient() {
  const { isEnabled } = await draftMode()
  if (!isEnabled) return null
  if (!(await getAdminRoleOrNull())) return null
  const supabase = await createServerSupabaseClient()
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return null
  return supabase
}

function overlay(post: BlogPost, stage: BlogPostStagedChange): BlogPost {
  const merged: BlogPost = { ...post }
  for (const field of STAGED_CONTENT_FIELDS) {
    ;(merged as unknown as Record<string, unknown>)[field] = stage[field]
  }
  merged.status = 'published'
  merged.published_at = post.status === 'published' && post.published_at ? post.published_at : new Date().toISOString()
  return merged
}

type StageWithPost = BlogPostStagedChange & { post: BlogPost | null }

/**
 * One post as it will be once its staged change is published, looked up by
 * the staged slug or the live slug. Null when preview is off, the visitor is
 * not an admin, or the post has no staged change (the caller then falls back
 * to the live read).
 */
export async function getPreviewPost(slug: string) {
  const supabase = await previewClient()
  if (!supabase) return null
  // Plain equality filters only: the slug comes from the URL.
  const byStagedSlug = await supabase
    .from('blog_post_staged_changes')
    .select('*, post:blog_posts(*)')
    .eq('slug', slug)
    .limit(1)
  let stage = (byStagedSlug.data?.[0] as StageWithPost | undefined) ?? null
  if (!stage) {
    const { data: live } = await supabase.from('blog_posts').select('id').eq('slug', slug).maybeSingle()
    if (!live) return null
    const byPost = await supabase
      .from('blog_post_staged_changes')
      .select('*, post:blog_posts(*)')
      .eq('post_id', live.id)
      .maybeSingle()
    stage = (byPost.data as StageWithPost | null) ?? null
  }
  if (!stage?.post) return null
  return { ...mapPost(overlay(stage.post, stage)), staged: true as const }
}

/**
 * The blog list as it will be: live posts with their staged changes laid
 * over them, plus staged drafts that would go live. Null when preview is off
 * or the visitor is not an admin.
 */
export async function getPreviewPosts() {
  const supabase = await previewClient()
  if (!supabase) return null
  const [{ data: live }, { data: stages }] = await Promise.all([
    supabase.from('blog_posts').select('*').eq('status', 'published'),
    supabase.from('blog_post_staged_changes').select('*, post:blog_posts(*)'),
  ])
  const byPost = new Map<string, StageWithPost>()
  for (const s of (stages ?? []) as StageWithPost[]) byPost.set(s.post_id, s)

  const rows: { post: BlogPost; staged: boolean }[] = []
  for (const post of (live ?? []) as BlogPost[]) {
    const stage = byPost.get(post.id)
    rows.push(stage ? { post: overlay(post, stage), staged: true } : { post, staged: false })
    byPost.delete(post.id)
  }
  for (const stage of byPost.values()) {
    if (stage.post) rows.push({ post: overlay(stage.post, stage), staged: true })
  }
  rows.sort((a, b) => (b.post.published_at ?? '').localeCompare(a.post.published_at ?? ''))
  return rows.map(({ post, staged }) => ({ ...mapPost(post), staged }))
}
