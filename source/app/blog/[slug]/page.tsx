// app/blog/[slug]/page.tsx: an example public post page, wired to the kit's
// SEO spine (docs/14) and the staging preview (docs/10). Style it as your
// site's own; the parts to keep are the metadata, the schema and the preview
// branch.
import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'
import JsonLd from '@/components/JsonLd'
import TipTapRenderer from '@/components/TipTapRenderer'
import { getBlogPost, getBlogSlugs } from '@/lib/data'
import { blogPostingJsonLd, breadcrumbJsonLd } from '@/lib/seo/json-ld'
import { postMetadata } from '@/lib/seo/metadata'
import { BLOG_BASE_PATH, postPath, siteConfig } from '@/lib/seo/site'
import { getPreviewPost } from '@/lib/staging/preview'

export const revalidate = 3600

type Props = { params: Promise<{ slug: string }> }

async function loadPost(slug: string) {
  const { isEnabled } = await draftMode()
  const preview = isEnabled ? await getPreviewPost(slug) : null
  return { post: preview || (await getBlogPost(slug)), preview: !!preview }
}

export async function generateStaticParams() {
  return (await getBlogSlugs()).map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const { post, preview } = await loadPost(slug)
  if (!post) return { title: 'Not found', robots: { index: false, follow: false } }
  // A staged preview is never indexed, whatever the site's switch says.
  return postMetadata(post, siteConfig(), { preview })
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const { post } = await loadPost(slug)
  if (!post) notFound()
  const site = siteConfig()

  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <JsonLd
        data={[
          blogPostingJsonLd(post, site),
          breadcrumbJsonLd(
            [
              { name: 'Home', path: '/' },
              { name: 'Blog', path: BLOG_BASE_PATH },
              { name: post.title, path: postPath(post.slug) },
            ],
            site,
          ),
        ]}
      />
      {/* The title is the page's one H1; the editor offers H2 and H3 for the body. */}
      <h1 className="heading-display text-4xl mb-4">{post.title}</h1>
      {post.publishedAt && (
        <p className="text-sm text-text-secondary mb-10">
          <time dateTime={post.publishedAt}>
            {new Date(post.publishedAt).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })}
          </time>
        </p>
      )}
      <TipTapRenderer value={post.body} />
    </article>
  )
}
