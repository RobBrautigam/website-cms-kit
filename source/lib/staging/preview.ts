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
import { STAGED_BUCKET, imagePathsIn, withSignedImages } from './images'

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
type PreviewClient = NonNullable<Awaited<ReturnType<typeof previewClient>>>

/**
 * Staged posts point at images that are not public yet (lib/staging/images.ts).
 * Swap those for signed links, signed with the admin's own session so the
 * staged bucket's policies decide. Images that are public already, or that
 * cannot be signed, keep their URL.
 */
async function withStagedImages(supabase: PreviewClient, posts: BlogPost[]): Promise<BlogPost[]> {
  const paths = Array.from(new Set(posts.flatMap((p) => imagePathsIn(p))))
  if (paths.length === 0) return posts
  const { data } = await supabase.storage.from(STAGED_BUCKET).createSignedUrls(paths, 600)
  const signed: Record<string, string> = {}
  for (const row of data ?? []) if (row.path && row.signedUrl && !row.error) signed[row.path] = row.signedUrl
  return posts.map((p) => withSignedImages(p, signed))
}

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
  // The post that owns this slug today wins, with its own staged copy, so a
  // staged rename of another post cannot shadow it. Only a slug no post owns
  // yet (a staged rename or a staged new post) is looked up among staged
  // copies, oldest first so the result is stable.
  let stage: StageWithPost | null = null
  const { data: owner } = await supabase.from('blog_posts').select('id').eq('slug', slug).maybeSingle()
  if (owner) {
    const byPost = await supabase
      .from('blog_post_staged_changes')
      .select('*, post:blog_posts(*)')
      .eq('post_id', owner.id)
      .maybeSingle()
    stage = (byPost.data as StageWithPost | null) ?? null
  } else {
    const byStagedSlug = await supabase
      .from('blog_post_staged_changes')
      .select('*, post:blog_posts(*)')
      .eq('slug', slug)
      .order('staged_at', { ascending: true })
      .limit(1)
    stage = (byStagedSlug.data?.[0] as StageWithPost | undefined) ?? null
  }
  if (!stage?.post) return null
  const [post] = await withStagedImages(supabase, [overlay(stage.post, stage)])
  return { ...mapPost(post), staged: true as const }
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
  const posts = await withStagedImages(supabase, rows.map((r) => r.post))
  return rows.map(({ staged }, i) => ({ ...mapPost(posts[i]), staged }))
}
