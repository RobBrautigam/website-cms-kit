import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getStagedChange } from '@/lib/staging/queries'
import PostForm from '@/components/admin/PostForm'

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
        publishedAt: post.published_at ? new Date(post.published_at).toISOString().slice(0, 16) : '',
        body: content.body,
        authorSlug: content.author_slug || 'jane-doe',
      }}
    />
  )
}
