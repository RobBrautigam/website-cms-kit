'use client'

import ImageUploader from './ImageUploader'
import AdminImage from './AdminImage'
import { searchPreview, socialPreview } from '@/lib/admin/previews'

// The public site's address for the previews (docs/09). A placeholder until set.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.example.com'

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
  /** When set, the status select is read-only and this note explains why
   *  (a live post's edits go through staging; see docs/10). */
  statusLockedNote?: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

export default function PostMetaSidebar({ meta, onChange, statusLockedNote }: PostMetaSidebarProps) {
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

      {/* Image Alt: required before the post goes live (lib/admin/alt-text.ts) */}
      {meta.featuredImageUrl && (
        <div>
          <label htmlFor="featured_image_alt" className="block text-sm font-semibold text-text-secondary mb-1.5">
            Image Alt Text <span className="font-normal text-text-secondary/70">(required to publish)</span>
          </label>
          <input
            id="featured_image_alt"
            type="text"
            value={meta.featuredImageAlt}
            onChange={(e) => update({ featuredImageAlt: e.target.value })}
            aria-invalid={!meta.featuredImageAlt.trim()}
            className={`w-full px-3 py-2.5 rounded-lg border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition ${meta.featuredImageAlt.trim() ? 'border-border' : 'border-amber-500'}`}
            placeholder="Describe the image"
          />
          {!meta.featuredImageAlt.trim() && (
            <p className="text-xs text-amber-700 mt-1.5">Say what the image shows. Screen readers read this, and it shows if the image fails to load.</p>
          )}
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

      <PostPreviews meta={meta} />

      {/* Status */}
      <div>
        <label htmlFor="post_status" className="block text-sm font-semibold text-text-secondary mb-1.5">Status</label>
        <select
          id="post_status"
          disabled={!!statusLockedNote}
          value={meta.status}
          onChange={(e) => update({ status: e.target.value as PostMeta['status'] })}
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="scheduled">Scheduled</option>
        </select>
        {statusLockedNote && <p className="text-xs text-text-secondary mt-1.5">{statusLockedNote}</p>}
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

/**
 * How the post will look in a search result and as a social share card,
 * from lib/admin/previews.ts. The search card keeps search engines' own link
 * colors (green address, blue title), not the brand palette, for fidelity.
 */
function PostPreviews({ meta }: { meta: PostMeta }) {
  const input = {
    title: meta.title,
    slug: meta.slug,
    excerpt: meta.excerpt,
    metaDescription: meta.metaDescription,
    featuredImageUrl: meta.featuredImageUrl,
    featuredImageAlt: meta.featuredImageAlt,
    siteUrl: SITE_URL,
  }
  const search = searchPreview(input)
  const social = socialPreview(input)
  const warnings = [...search.warnings, ...social.warnings]
  return (
    <div className="space-y-3">
      <p className="block text-sm font-semibold text-text-secondary">Search Preview</p>
      <div className="rounded-lg border border-border bg-white p-4 space-y-1" data-preview="search">
        <p className="text-[13px] text-green-700 truncate">{search.breadcrumb}</p>
        <p className="text-[17px] text-blue-800 font-medium leading-snug">{search.title}</p>
        <p className="text-[13px] text-gray-600 leading-relaxed">
          {search.description || 'Search engines will pick their own text from the post.'}
        </p>
      </div>
      <p className="block text-sm font-semibold text-text-secondary pt-1">Social Preview</p>
      <div className="rounded-lg border border-border bg-bg-white overflow-hidden" data-preview="social">
        {social.image ? (
          <AdminImage src={social.image} alt={social.imageAlt} className="w-full aspect-[1.91/1] object-cover" />
        ) : (
          <div className="w-full aspect-[1.91/1] bg-bg-card flex items-center justify-center text-xs text-text-secondary">No image</div>
        )}
        <div className="p-3 space-y-0.5 border-t border-border">
          <p className="text-[11px] tracking-wide text-text-secondary">{social.domain}</p>
          <p className="text-sm font-semibold text-text-primary leading-snug">{social.title}</p>
          {social.description && <p className="text-xs text-text-secondary line-clamp-2">{social.description}</p>}
        </div>
      </div>
      {warnings.length > 0 && (
        <ul className="text-xs text-amber-700 space-y-1 list-disc pl-4">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
