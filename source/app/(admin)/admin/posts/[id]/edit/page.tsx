import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getStagedChange } from '@/lib/staging/queries'
import PostForm from '@/components/admin/PostForm'
import SchedulePanel from '@/components/admin/SchedulePanel'
import RevisionsPanel, { type RevisionRow } from '@/components/admin/RevisionsPanel'

/** A timestamp as the editor's date fields hold it: UTC, to the minute. */
function utcInput(value: string | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 16) : ''
}

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/admin/login')

  const { data: post } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('id', id)
    .single()

  if (!post) notFound()

  // When the post has a staged copy, the editor opens on it: the content
  // comes from the staged row, the status and dates from the live post.
  const staged = await getStagedChange(post.id)
  const content = staged ?? post
  const goesLive = post.status === 'published' || post.status === 'scheduled'

  // The latest revisions (migration 003, section 20). Before 003 has run the
  // table is missing and the panel just shows none.
  let revisions: RevisionRow[] = []
  if (goesLive) {
    const { data } = await supabase
      .from('blog_post_revisions')
      .select('id, seq, title, status, changed_fields, saved_at, saved_by')
      .eq('post_id', post.id)
      .order('seq', { ascending: false })
      .limit(20)
    revisions = (data ?? []).map((r) => ({
      id: r.id as string,
      seq: Number(r.seq),
      title: r.title as string,
      status: r.status as string,
      changedFields: (r.changed_fields as string[] | null) ?? [],
      savedAt: r.saved_at as string,
      savedBy: r.saved_by === null ? 'the scheduler' : r.saved_by === user.id ? 'you' : 'a teammate',
    }))
  }

  return (
    <PostForm
      staged={staged ? { id: staged.id, reviewStatus: staged.review_status } : null}
      initialData={{
        id: post.id,
        title: content.title,
        slug: content.slug,
        excerpt: content.excerpt || '',
        metaDescription: content.meta_description || '',
        categories: content.categories || [],
        featuredImageUrl: content.featured_image_url || '',
        featuredImageAlt: content.featured_image_alt || '',
        status: post.status,
        publishedAt: utcInput(post.published_at),
        body: content.body,
        authorSlug: content.author_slug || 'jane-doe',
      }}
    >
      {goesLive && (
        <>
          <SchedulePanel
            postId={post.id}
            status={post.status}
            publishedAt={utcInput(post.published_at)}
            unpublishAt={utcInput(post.unpublish_at)}
          />
          <RevisionsPanel revisions={revisions} hasStagedCopy={!!staged} />
        </>
      )}
    </PostForm>
  )
}
