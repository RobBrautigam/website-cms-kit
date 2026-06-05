import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
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

  return (
    <PostForm
      initialData={{
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt || '',
        metaDescription: post.meta_description || '',
        categories: post.categories || [],
        featuredImageUrl: post.featured_image_url || '',
        featuredImageAlt: post.featured_image_alt || '',
        status: post.status,
        publishedAt: post.published_at ? new Date(post.published_at).toISOString().slice(0, 16) : '',
        body: post.body,
        authorSlug: post.author_slug || 'jane-doe',
      }}
    />
  )
}
