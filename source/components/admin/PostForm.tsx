'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PostEditor from './PostEditor'
import PostMetaSidebar from './PostMetaSidebar'
import type { PostMeta } from './PostMetaSidebar'
import TipTapRenderer from '@/components/TipTapRenderer'
import Link from 'next/link'
import { autosaveStaged, prepareToGoLive, promotePostImages, publishNow, stageChanges } from '@/app/(admin)/admin/staging/actions'
import { altTextRefusal } from '@/lib/admin/alt-text'
import { AUTOSAVE_DELAY_MS, autosaveLabel, autosaveTarget, createSaveGate, isDirty, snapshot } from '@/lib/admin/autosave'
import { reviewLabel, type ReviewStatus } from '@/lib/staging/rules'

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
  /** The post's staged copy, when it has one. initialData then carries the
   *  staged content, so the editor opens on the staged copy. */
  staged?: { id: string; reviewStatus: ReviewStatus } | null
  /** Shown under the sidebar on the edit screen: the schedule and revisions panels. */
  children?: React.ReactNode
}

export default function PostForm({ initialData, staged = null, children }: PostFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const isEditing = !!initialData?.id
  // Edits to a live post go through staging (docs/10): "Stage changes" keeps
  // the live post as it is; "Publish now" stages and publishes in one step.
  // A scheduled post does too (1.4.0): it goes live on its own at its date,
  // so its edits wait in the staged copy and are applied the same way.
  const isLive = isEditing && initialData?.status === 'published'
  const isScheduled = isEditing && initialData?.status === 'scheduled'
  const viaStaging = isLive || isScheduled
  // An explicit save waits for an autosave in flight and stops new ones.
  const gate = useRef(createSaveGate()).current
  const [pausedByReview, setPausedByReview] = useState(false)
  const [imageWarning, setImageWarning] = useState<string | null>(null)
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

  // The editable content, in the database's field names. Status and the
  // publish date are not content: an autosave never changes them.
  const contentOf = useCallback(
    (m: PostMeta, b: Record<string, unknown>) => ({
      title: m.title,
      slug: m.slug,
      excerpt: m.excerpt,
      meta_description: m.metaDescription,
      categories: m.categories,
      featured_image_url: m.featuredImageUrl,
      featured_image_alt: m.featuredImageAlt,
      body: b,
      author_slug: m.authorSlug || DEFAULT_AUTHOR_SLUG,
    }),
    []
  )

  // Unsaved changes and server autosave (lib/admin/autosave.ts): a draft
  // saves to its own row, a live post to its staged copy, a new post stays in
  // this browser until the first save.
  const target = autosaveTarget({
    postId: initialData?.id,
    isLive,
    isScheduled,
    stagedReviewStatus: pausedByReview ? 'in_review' : (staged?.reviewStatus ?? null),
  })
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(contentOf(meta, body)))
  const [autosaving, setAutosaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [autosaveError, setAutosaveError] = useState<string | null>(null)
  // A status or date change is unsaved too, but only Save writes it.
  const [savedSchedule] = useState(() => `${meta.status}|${meta.publishedAt}`)
  const contentDirty = isDirty(savedSnapshot, contentOf(meta, body))
  const dirty = contentDirty || `${meta.status}|${meta.publishedAt}` !== savedSchedule
  const leaving = useRef(false)

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      if (leaving.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    if (!contentDirty || saving || autosaving || (target !== 'draft' && target !== 'staged')) return
    if (!meta.title.trim() || !meta.slug.trim()) return
    const timer = setTimeout(async () => {
      const content = contentOf(meta, body)
      setAutosaving(true)
      let error: string | null = null
      try {
        await gate.autosave(async () => {
          if (target === 'draft') {
            const result = await supabase.from('blog_posts').update(content).eq('id', initialData!.id!)
            error = result.error?.message ?? null
          } else {
            // Into the staged copy, only while nobody has sent it for review.
            const result = await autosaveStaged(initialData!.id!, content)
            error = result.ok ? null : result.error
            if (result.ok && result.data?.paused) {
              setPausedByReview(true)
              return
            }
          }
          if (!error) {
            setSavedSnapshot(snapshot(content))
            setSavedAt(new Date())
          }
        })
      } catch (e) {
        error = e instanceof Error ? e.message : 'Autosave failed'
      }
      setAutosaving(false)
      setAutosaveError(error)
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [contentDirty, saving, autosaving, target, meta, body, contentOf, supabase, initialData, gate])

  function confirmLeave(): boolean {
    if (!dirty) return true
    return window.confirm('You have unsaved changes. Leave without saving them?')
  }

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
    await gate.beginSave()
    const stop = () => { gate.endSave(); setSaving(false) }

    // Going live (now or on a schedule): alt text first. The post's private
    // staged images go public only after the write below succeeded.
    const goingLive = meta.status !== 'draft'
    if (goingLive) {
      const missing = altTextRefusal({ featuredImageUrl: meta.featuredImageUrl, featuredImageAlt: meta.featuredImageAlt, body })
      if (missing) { alert(missing); stop(); return }
      const ready = await prepareToGoLive({ featured_image_url: meta.featuredImageUrl, featured_image_alt: meta.featuredImageAlt, body })
      if (!ready.ok) { alert(ready.error); stop(); return }
    }

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
      // The field holds UTC (it says so); never the browser's own zone.
      postData.published_at = new Date(`${meta.publishedAt}Z`).toISOString()
    } else {
      postData.published_at = null
    }

    // Remove undefined values
    Object.keys(postData).forEach((key) => {
      if (postData[key] === undefined) delete postData[key]
    })

    let error
    let postId = initialData?.id
    if (isEditing) {
      const result = await supabase.from('blog_posts').update(postData).eq('id', initialData.id)
      error = result.error
    } else {
      const result = await supabase.from('blog_posts').insert(postData).select('id').single()
      error = result.error
      postId = result.data?.id
    }

    if (error) {
      alert('Save failed: ' + error.message)
      stop()
      return
    }

    if (goingLive && postId) {
      const promoted = await promotePostImages(postId)
      if (!promoted.ok) {
        alert(`Saved, but an image could not be made public yet: ${promoted.error} Open the post and press Make images public to try again.`)
      }
    }

    // Clear auto-saved draft
    localStorage.removeItem(storageKey)
    leaving.current = true

    await fetch('/api/revalidate', { method: 'POST' })
    router.push('/admin/posts')
    router.refresh()
  }

  async function handleStage(andPublish: boolean) {
    if (!initialData?.id) return
    if (!meta.title.trim()) { alert('Title is required'); return }
    if (!meta.slug.trim()) { alert('Slug is required'); return }

    if (andPublish) {
      const missing = altTextRefusal({ featuredImageUrl: meta.featuredImageUrl, featuredImageAlt: meta.featuredImageAlt, body })
      if (missing) { alert(missing); return }
    }

    setSaving(true)
    await gate.beginSave()
    const content = contentOf(meta, body)
    const result = andPublish
      ? await publishNow(initialData.id, content)
      : await stageChanges(initialData.id, content)

    if (!result.ok) {
      alert(result.error)
      gate.endSave()
      setSaving(false)
      router.refresh()
      return
    }

    localStorage.removeItem(storageKey)
    const warning = andPublish ? (result.data as { imageWarning?: string } | undefined)?.imageWarning : undefined
    if (warning) {
      // Live, but an image is still private: stay here and offer the retry.
      setImageWarning(warning)
      setSavedSnapshot(snapshot(content))
      gate.endSave()
      setSaving(false)
      router.refresh()
      return
    }
    leaving.current = true
    router.push(andPublish ? '/admin/posts' : '/admin/staging')
    router.refresh()
  }

  async function handleMakeImagesPublic() {
    if (!initialData?.id) return
    const result = await promotePostImages(initialData.id)
    if (!result.ok) alert(result.error)
    else if (result.data?.waitsForDate) alert('This post is scheduled: its images go public at its date, copied by the scheduled-publishing job.')
    else setImageWarning(null)
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
          <span className="text-xs text-text-secondary" role="status" aria-live="polite" data-autosave={target}>
            {autoSaved && target === 'browser'
              ? 'Kept in this browser'
              : autosaveLabel({ target, dirty, saving: autosaving, savedAt, error: autosaveError })}
          </span>
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
            onClick={() => {
              if (!confirmLeave()) return
              leaving.current = true
              router.back()
            }}
            className="px-4 py-2 rounded-lg border border-border text-text-secondary text-sm font-medium hover:bg-bg-card transition-colors"
          >
            Cancel
          </button>
          {viaStaging ? (
            <>
              <button
                type="button"
                onClick={() => handleStage(false)}
                disabled={saving}
                className="px-4 py-2 rounded-lg border border-accent text-accent text-sm font-bold hover:bg-accent/5 transition-colors disabled:opacity-50"
              >
                Stage changes
              </button>
              <button
                type="button"
                onClick={() => handleStage(true)}
                disabled={saving}
                className="btn-primary px-5 py-2 text-sm font-bold disabled:opacity-50"
              >
                {saving ? 'Saving...' : isScheduled ? 'Apply to scheduled post' : 'Publish now'}
              </button>
            </>
          ) : staged ? (
            // A draft with a staged copy: the form holds the staged copy, so
            // saving goes back to it. Writing the draft row here would be
            // overwritten when the staged copy is published.
            <button
              type="button"
              onClick={() => handleStage(false)}
              disabled={saving}
              className="btn-primary px-5 py-2 text-sm font-bold disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save staged copy'}
            </button>
          ) : (
            <>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => handleStage(false)}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg border border-accent text-accent text-sm font-bold hover:bg-accent/5 transition-colors disabled:opacity-50"
                >
                  Stage for publishing
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary px-5 py-2 text-sm font-bold disabled:opacity-50"
              >
                {saving ? 'Saving...' : isEditing ? 'Update' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {imageWarning && (
        <div role="alert" className="mb-4 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-text-secondary">{imageWarning}</span>
          <button type="button" onClick={handleMakeImagesPublic} className="text-sm font-bold text-accent hover:underline">
            Make images public
          </button>
        </div>
      )}

      {staged && (
        <div className="mb-4 p-3 rounded-lg border border-accent/30 bg-accent/5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-text-secondary">
            You are editing the staged copy ({reviewLabel(staged.reviewStatus)}). The live post stays as it is until
            this is published. Changing it sends it back to Staged.
          </span>
          <Link href="/admin/staging" className="text-sm font-bold text-accent hover:underline">Open staging</Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <PostEditor content={body} onChange={setBody} key={editorKey} />
        <div className="space-y-6">
          <PostMetaSidebar
            meta={meta}
            onChange={setMeta}
            statusLockedNote={
              isLive
                ? 'Live. To take it down, use the status badge on the posts list, or set a take-down time below.'
                : isScheduled
                  ? 'Scheduled. Change its dates below; content edits go through the staged copy.'
                  : staged
                    ? 'Staged. Publish it from Staging, or discard the staged copy to change the status here.'
                    : undefined
            }
          />
          {children}
        </div>
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
