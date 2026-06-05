'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PostEditor from './PostEditor'
import PostMetaSidebar from './PostMetaSidebar'
import type { PostMeta } from './PostMetaSidebar'
import TipTapRenderer from '@/components/TipTapRenderer'

const DEFAULT_AUTHOR_SLUG = 'jane-doe'

interface PostData {
  id?: string
  title: string
  slug: string
  excerpt: string
  metaDescription: string
  categories: string[]
  featuredImageUrl: string
  featuredImageAlt: string
  status: 'draft' | 'published' | 'scheduled'
  publishedAt: string
  body: Record<string, unknown>
  authorSlug?: string
}

interface PostFormProps {
  initialData?: PostData
}

export default function PostForm({ initialData }: PostFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const isEditing = !!initialData?.id
  const [saving, setSaving] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [autoSaved, setAutoSaved] = useState(false)
  const [showRestore, setShowRestore] = useState(false)
  const [savedDraft, setSavedDraft] = useState<{ body: Record<string, unknown>; meta: PostMeta } | null>(null)

  const storageKey = `cms-draft-${initialData?.id || 'new'}`

  const [body, setBody] = useState<Record<string, unknown>>(initialData?.body || {})
  const [editorKey, setEditorKey] = useState(0)
  const [meta, setMeta] = useState<PostMeta>({
    title: initialData?.title || '',
    slug: initialData?.slug || '',
    excerpt: initialData?.excerpt || '',
    metaDescription: initialData?.metaDescription || '',
    categories: initialData?.categories || [],
    featuredImageUrl: initialData?.featuredImageUrl || '',
    featuredImageAlt: initialData?.featuredImageAlt || '',
    status: initialData?.status || 'draft',
    publishedAt: initialData?.publishedAt || '',
    authorSlug: initialData?.authorSlug || DEFAULT_AUTHOR_SLUG,
  })

  // Check for saved draft on mount.
  // The setState calls below are flagged by react-hooks/set-state-in-effect, but
  // localStorage is a browser-only API that returns null during SSR. Reading it
  // in useEffect (after hydration) and revealing the restore prompt is the
  // hydration-safe pattern: initial render matches SSR (no draft visible), then
  // the client reveals if a draft exists. Disabling per-line with rationale.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe localStorage reveal
        setSavedDraft(parsed)
        setShowRestore(true)
      }
    } catch { /* ignore */ }
  }, [storageKey])

  // Auto-save every 30 seconds
  const autoSave = useCallback(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ body, meta }))
      setAutoSaved(true)
      setTimeout(() => setAutoSaved(false), 2000)
    } catch { /* ignore */ }
  }, [body, meta, storageKey])

  useEffect(() => {
    const timer = setInterval(autoSave, 30000)
    return () => clearInterval(timer)
  }, [autoSave])

  function handleRestore() {
    if (!savedDraft) return
    setMeta(savedDraft.meta)
    setBody(savedDraft.body)
    setEditorKey((k) => k + 1)
    setShowRestore(false)
  }

  async function handleSave() {
    if (!meta.title.trim()) { alert('Title is required'); return }
    if (!meta.slug.trim()) { alert('Slug is required'); return }
    if (meta.status === 'scheduled' && !meta.publishedAt) { alert('Scheduled posts need a publish date'); return }

    setSaving(true)

    const postData: Record<string, unknown> = {
      title: meta.title,
      slug: meta.slug,
      excerpt: meta.excerpt || null,
      meta_description: meta.metaDescription || null,
      categories: meta.categories,
      featured_image_url: meta.featuredImageUrl || null,
      featured_image_alt: meta.featuredImageAlt || null,
      status: meta.status,
      body,
      author_slug: meta.authorSlug || DEFAULT_AUTHOR_SLUG,
    }

    if (meta.status === 'published') {
      postData.published_at = isEditing ? undefined : new Date().toISOString()
    } else if (meta.status === 'scheduled') {
      postData.published_at = new Date(meta.publishedAt).toISOString()
    } else {
      postData.published_at = null
    }

    // Remove undefined values
    Object.keys(postData).forEach((key) => {
      if (postData[key] === undefined) delete postData[key]
    })

    let error
    if (isEditing) {
      const result = await supabase.from('blog_posts').update(postData).eq('id', initialData.id)
      error = result.error
    } else {
      const result = await supabase.from('blog_posts').insert(postData)
      error = result.error
    }

    if (error) {
      alert('Save failed: ' + error.message)
      setSaving(false)
      return
    }

    // Clear auto-saved draft
    localStorage.removeItem(storageKey)

    await fetch('/api/revalidate', { method: 'POST' })
    router.push('/admin/posts')
    router.refresh()
  }

  function handleAIGenerated(data: {
    title: string
    slug: string
    excerpt: string
    body: Record<string, unknown>
    metaDescription: string
    suggestedCategories: string[]
  }) {
    setMeta((prev) => ({
      ...prev,
      title: data.title,
      slug: data.slug,
      excerpt: data.excerpt,
      metaDescription: data.metaDescription,
      categories: data.suggestedCategories,
    }))
    setBody(data.body)
    setEditorKey((k) => k + 1)
    setShowAI(false)
  }

  return (
    <>
      {/* Restore Banner */}
      {showRestore && (
        <div className="mb-4 p-3 rounded-lg border border-accent/30 bg-accent/5 flex items-center justify-between">
          <span className="text-sm text-text-secondary">Unsaved draft found. Restore it?</span>
          <div className="flex gap-2">
            <button onClick={handleRestore} className="text-sm font-bold text-accent hover:underline">Restore</button>
            <button onClick={() => { setShowRestore(false); localStorage.removeItem(storageKey) }} className="text-sm text-text-secondary hover:underline">Dismiss</button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-black" style={{ fontFamily: 'var(--font-display)' }}>
            {isEditing ? 'EDIT POST' : 'NEW POST'}
          </h1>
          {autoSaved && (
            <span className="text-xs text-text-secondary/60 animate-pulse">Auto-saved</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowAI(true)}
            className="px-4 py-2 rounded-lg border border-accent text-accent text-sm font-bold hover:bg-accent/5 transition-colors"
          >
            AI Generate
          </button>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="px-4 py-2 rounded-lg border border-border text-text-secondary text-sm font-medium hover:bg-bg-card transition-colors"
          >
            Preview
          </button>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 rounded-lg border border-border text-text-secondary text-sm font-medium hover:bg-bg-card transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary px-5 py-2 text-sm font-bold disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEditing ? 'Update' : 'Save'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <PostEditor content={body} onChange={setBody} key={editorKey} />
        <PostMetaSidebar meta={meta} onChange={setMeta} />
      </div>

      {/* AI Generate Modal */}
      {showAI && (
        <AIGenerateModal
          onClose={() => setShowAI(false)}
          onGenerated={handleAIGenerated}
        />
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-bg-white z-50 overflow-y-auto">
          <div className="sticky top-0 bg-bg-white border-b border-border px-5 py-3 flex items-center justify-between z-10">
            <span className="text-sm font-bold text-text-secondary uppercase tracking-wider">Preview</span>
            <button
              onClick={() => setShowPreview(false)}
              className="btn-primary px-4 py-1.5 text-sm font-bold"
            >
              Close Preview
            </button>
          </div>
          <section className="py-20 md:py-28 bg-bg-white">
            <div className="max-w-[820px] mx-auto px-5 sm:px-8">
              {meta.categories.length > 0 && (
                <div className="flex gap-2 mb-6">
                  {meta.categories.map((cat) => (
                    <span key={cat} className="text-[11px] text-accent bg-accent-soft px-3 py-1 rounded-full font-extrabold uppercase tracking-wide">
                      {cat}
                    </span>
                  ))}
                </div>
              )}
              <h1 className="heading-display text-[clamp(2rem,5vw,3.5rem)] mb-6">
                {meta.title || 'Untitled Post'}
              </h1>
              <p className="text-sm text-text-secondary">Preview Mode</p>
            </div>
          </section>
          {meta.featuredImageUrl && (
            <div className="max-w-[1080px] mx-auto px-5 sm:px-8 -mt-4 mb-12">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={meta.featuredImageUrl} alt={meta.featuredImageAlt || meta.title} className="w-full rounded-2xl" />
            </div>
          )}
          <article className="max-w-[720px] mx-auto px-5 sm:px-8 pb-20">
            {body && Object.keys(body).length > 0 && <TipTapRenderer value={body} />}
          </article>
        </div>
      )}
    </>
  )
}

// AI Generate Modal
function AIGenerateModal({
  onClose,
  onGenerated,
}: {
  onClose: () => void
  onGenerated: (data: {
    title: string
    slug: string
    excerpt: string
    body: Record<string, unknown>
    metaDescription: string
    suggestedCategories: string[]
  }) => void
}) {
  const [topic, setTopic] = useState('')
  const [keywords, setKeywords] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGenerate() {
    if (!topic.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Generation failed')
      }

      const data = await res.json()
      onGenerated(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-5">
      <div className="bg-bg-white border border-border rounded-2xl p-6 w-full max-w-lg shadow-xl">
        <h2 className="text-lg font-black mb-1" style={{ fontFamily: 'var(--font-display)' }}>
          AI BLOG GENERATOR
        </h2>
        <p className="text-sm text-text-secondary mb-5">
          Enter a topic and optional keywords. AI will generate a full SEO-optimized blog post in your brand&apos;s voice.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-text-secondary mb-1.5">Topic</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
              placeholder="e.g., How to migrate a Next.js app to the App Router"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-text-secondary mb-1.5">
              Keywords <span className="font-normal text-text-secondary/60">(comma separated, optional)</span>
            </label>
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
              placeholder="e.g., next.js, app router, migration"
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-text-secondary text-sm font-medium hover:bg-bg-card transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading || !topic.trim()}
              className="btn-primary px-5 py-2 text-sm font-bold disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Post'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
