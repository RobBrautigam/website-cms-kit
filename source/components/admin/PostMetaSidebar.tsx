'use client'

import ImageUploader from './ImageUploader'

// Replace these with your own categories + authors. In the reference app the
// author list came from a shared team module; here it is a static placeholder
// so the kit has no external data dependency. Wire it to your own users /
// authors source when you adopt this.
const CATEGORIES = [
  { value: 'product', label: 'Product' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'company', label: 'Company' },
  { value: 'guides', label: 'Guides' },
  { value: 'news', label: 'News' },
]

const AUTHOR_OPTIONS = [
  { value: 'jane-doe', label: 'Jane Doe' },
  { value: 'john-smith', label: 'John Smith' },
]

const DEFAULT_AUTHOR_SLUG = 'jane-doe'

export interface PostMeta {
  title: string
  slug: string
  excerpt: string
  metaDescription: string
  categories: string[]
  featuredImageUrl: string
  featuredImageAlt: string
  status: 'draft' | 'published' | 'scheduled'
  publishedAt: string
  authorSlug: string
}

interface PostMetaSidebarProps {
  meta: PostMeta
  onChange: (meta: PostMeta) => void
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

export default function PostMetaSidebar({ meta, onChange }: PostMetaSidebarProps) {
  function update(partial: Partial<PostMeta>) {
    onChange({ ...meta, ...partial })
  }

  return (
    <div className="space-y-5">
      {/* Author */}
      <div>
        <label htmlFor="author_slug" className="block text-sm font-semibold text-text-secondary mb-1.5">Author</label>
        <select
          id="author_slug"
          name="author_slug"
          value={meta.authorSlug || DEFAULT_AUTHOR_SLUG}
          onChange={(e) => update({ authorSlug: e.target.value })}
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
        >
          {AUTHOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm font-semibold text-text-secondary mb-1.5">Title</label>
        <input
          type="text"
          value={meta.title}
          onChange={(e) => update({ title: e.target.value, slug: slugify(e.target.value) })}
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
          placeholder="Post title"
        />
      </div>

      {/* Slug */}
      <div>
        <label className="block text-sm font-semibold text-text-secondary mb-1.5">Slug</label>
        <div className="flex items-center gap-1 text-sm text-text-secondary">
          <span>/blog/</span>
          <input
            type="text"
            value={meta.slug}
            onChange={(e) => update({ slug: slugify(e.target.value) })}
            className="flex-1 px-2 py-2 rounded border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
          />
        </div>
      </div>

      {/* Categories */}
      <div>
        <label className="block text-sm font-semibold text-text-secondary mb-1.5">Categories</label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => {
            const isSelected = meta.categories.includes(cat.value)
            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => {
                  const newCats = isSelected
                    ? meta.categories.filter((c) => c !== cat.value)
                    : [...meta.categories, cat.value]
                  update({ categories: newCats })
                }}
                className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full transition-colors ${
                  isSelected
                    ? 'bg-accent text-white'
                    : 'bg-bg-card text-text-secondary hover:text-accent border border-border'
                }`}
              >
                {cat.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Featured Image */}
      <ImageUploader
        currentUrl={meta.featuredImageUrl}
        onUpload={(url) => update({ featuredImageUrl: url })}
      />

      {/* Image Alt */}
      {meta.featuredImageUrl && (
        <div>
          <label className="block text-sm font-semibold text-text-secondary mb-1.5">Image Alt Text</label>
          <input
            type="text"
            value={meta.featuredImageAlt}
            onChange={(e) => update({ featuredImageAlt: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
            placeholder="Describe the image"
          />
        </div>
      )}

      {/* Excerpt */}
      <div>
        <label className="block text-sm font-semibold text-text-secondary mb-1.5">Excerpt</label>
        <textarea
          value={meta.excerpt}
          onChange={(e) => update({ excerpt: e.target.value })}
          rows={3}
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm resize-none transition"
          placeholder="Short summary for blog cards"
        />
      </div>

      {/* Meta Description */}
      <div>
        <label className="block text-sm font-semibold text-text-secondary mb-1.5">
          Meta Description
          <span className={`ml-2 text-xs font-normal ${meta.metaDescription.length > 160 ? 'text-red-500' : 'text-text-secondary/60'}`}>
            {meta.metaDescription.length}/160
          </span>
        </label>
        <textarea
          value={meta.metaDescription}
          onChange={(e) => update({ metaDescription: e.target.value })}
          rows={2}
          maxLength={200}
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm resize-none transition"
          placeholder="SEO description for search engines"
        />
      </div>

      {/* SEO Preview — uses Google's actual SERP link colors (green URL, blue
          title) so you can preview how the post will look in search results.
          These green/blue values intentionally do NOT use the brand palette;
          they mirror Google's own SERP colors for fidelity. */}
      <div>
        <label className="block text-sm font-semibold text-text-secondary mb-1.5">Search Preview</label>
        <div className="rounded-lg border border-border bg-white p-4 space-y-1">
          <p className="text-[13px] text-green-700 truncate">
            example.com &rsaquo; blog &rsaquo; {meta.slug || 'your-post-slug'}
          </p>
          <p className="text-[17px] text-blue-800 font-medium leading-snug line-clamp-1">
            {meta.title || 'Post Title'} | Acme
          </p>
          <p className="text-[13px] text-gray-600 line-clamp-2 leading-relaxed">
            {meta.metaDescription || meta.excerpt || 'Add a meta description to see how this post will appear in search results.'}
          </p>
        </div>
      </div>

      {/* Status */}
      <div>
        <label className="block text-sm font-semibold text-text-secondary mb-1.5">Status</label>
        <select
          value={meta.status}
          onChange={(e) => update({ status: e.target.value as PostMeta['status'] })}
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="scheduled">Scheduled</option>
        </select>
      </div>

      {/* Scheduled Date */}
      {meta.status === 'scheduled' && (
        <div>
          <label className="block text-sm font-semibold text-text-secondary mb-1.5">Publish Date & Time</label>
          <input
            type="datetime-local"
            value={meta.publishedAt}
            onChange={(e) => update({ publishedAt: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
          />
        </div>
      )}
    </div>
  )
}
