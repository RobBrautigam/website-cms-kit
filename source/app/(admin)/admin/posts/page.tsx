import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require'
import PostsTable from '@/components/admin/PostsTable'

export const dynamic = 'force-dynamic'

export default async function AdminPostsPage() {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()

  const { data: posts } = await supabase
    .from('blog_posts')
    .select('id, title, slug, status, published_at, categories, author_slug')
    .order('updated_at', { ascending: false })

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-black" style={{ fontFamily: 'var(--font-display)' }}>
          BLOG POSTS
        </h1>
        <Link
          href="/admin/posts/new"
          className="btn-primary px-5 py-2.5 text-sm font-bold"
        >
          + New Post
        </Link>
      </div>
      <PostsTable posts={posts || []} />
    </>
  )
}
