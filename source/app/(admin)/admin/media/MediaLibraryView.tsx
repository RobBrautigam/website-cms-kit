'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import AdminImage from '@/components/admin/AdminImage'
import ConfirmDialog from '@/components/admin/ConfirmDialog'
import { createClient } from '@/lib/supabase/client'
import { IMAGE_ACCEPT, uploadBlogImage } from '@/lib/admin/upload-image'
import { imagePathFromUrl } from '@/lib/staging/images'
import { filterMedia, MEDIA_ALT_MAX, MEDIA_PAGE_SIZE, type MediaAsset, type MediaFilter } from '@/lib/media/library'
import { deleteMediaAsset, saveMediaAlt } from './actions'

const PUBLIC_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/blog-images/`

const FILTERS: { id: MediaFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'private', label: 'Private' },
  { id: 'public', label: 'Public' },
  { id: 'unused', label: 'Unused' },
  { id: 'missing_alt', label: 'Missing alt text' },
]

function stateBadge(a: MediaAsset) {
  switch (a.state) {
    case 'private':
      return { label: 'Private', className: 'bg-yellow-500/10 text-yellow-700', title: 'Waiting in the private bucket until its post goes live' }
    case 'public':
      return { label: 'Public', className: 'bg-green-500/10 text-green-700', title: 'Made public by the kit when its post went live' }
    default:
      return {
        label: 'Not promoted by the kit',
        className: 'bg-red-500/10 text-red-700',
        title: 'In the public bucket with no promotion record: uploaded straight to it, so it never went through review here',
      }
  }
}

const USE_LABEL = { post: 'Post', staged: 'Staged change', revision: 'Kept revision', testimonial: 'Testimonial' } as const

function formatBytes(n: number | null) {
  if (n === null) return ''
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function MediaLibraryView({ assets, reviewRequired }: { assets: MediaAsset[]; reviewRequired: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [filter, setFilter] = useState<MediaFilter>('all')
  const [page, setPage] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<MediaAsset | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const shown = useMemo(() => filterMedia(assets, filter), [assets, filter])
  const pages = Math.max(1, Math.ceil(shown.length / MEDIA_PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const slice = shown.slice(current * MEDIA_PAGE_SIZE, (current + 1) * MEDIA_PAGE_SIZE)

  function saveAlt(a: MediaAsset) {
    const text = drafts[a.path] ?? a.alt
    startTransition(async () => {
      const r = await saveMediaAlt(a.path, text)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Alt text saved. It is offered the next time this image is picked.')
      setDrafts((d) => {
        const next = { ...d }
        delete next[a.path]
        return next
      })
      router.refresh()
    })
  }

  function remove(a: MediaAsset) {
    startTransition(async () => {
      const r = await deleteMediaAsset(a.path)
      setConfirm(null)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Image deleted.')
      router.refresh()
    })
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const result = await uploadBlogImage(createClient(), file)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      const path = imagePathFromUrl(result.url)
      toast.success('Uploaded. It stays private until a post using it goes live. Add its alt text below.')
      if (path) setDrafts((d) => ({ ...d, [path]: '' }))
      setFilter('missing_alt')
      setPage(0)
      router.refresh()
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, filterMedia(assets, f.id).length])) as Record<MediaFilter, number>,
    [assets]
  )

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div role="tablist" aria-label="Filter images" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => {
                setFilter(f.id)
                setPage(0)
              }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                filter === f.id ? 'bg-accent text-white border-accent' : 'border-border text-text-secondary hover:text-accent'
              }`}
            >
              {f.label} <span className="opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : 'Upload image'}
        </button>
        <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} onChange={upload} className="hidden" />
      </div>

      {reviewRequired && (
        <p className="text-xs text-text-secondary mb-4">
          Review is required: private images are write-once, so they cannot be deleted here. Unused ones are removed by
          the staged-image cleanup in Settings after 48 hours.
        </p>
      )}

      {slice.length === 0 ? (
        <p className="text-sm text-text-secondary py-10 text-center border border-dashed border-border rounded-xl">
          {assets.length === 0 ? 'No images yet. Upload one, or add one to a post.' : 'No images match this filter.'}
        </p>
      ) : (
        <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {slice.map((a) => {
            const badge = stateBadge(a)
            const draft = drafts[a.path] ?? a.alt
            const altId = `alt-${a.path.replace(/[^A-Za-z0-9]/g, '-')}`
            return (
              <li key={a.path} className="border border-border rounded-xl overflow-hidden bg-bg-white flex flex-col">
                <AdminImage
                  src={`${PUBLIC_BASE}${a.path}`}
                  alt={a.alt || 'No alt text yet'}
                  className="w-full aspect-[16/10] object-cover bg-bg-card"
                  loading="lazy"
                />
                <div className="p-4 flex flex-col gap-3 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full font-semibold ${badge.className}`} title={badge.title}>
                      {badge.label}
                    </span>
                    {a.leftoverStagedCopy && (
                      <span className="px-2 py-0.5 rounded-full bg-bg-card text-text-secondary" title="A promotion left its private copy behind; the next promotion or the cleanup removes it">
                        Private copy left over
                      </span>
                    )}
                    <span className="text-text-secondary">{formatBytes(a.size)}</span>
                  </div>
                  <code className="text-[11px] text-text-secondary break-all">{a.path}</code>
                  {a.promotedAt && (
                    <p className="text-xs text-text-secondary">Made public {new Date(a.promotedAt).toLocaleString()}</p>
                  )}
                  <div>
                    <label htmlFor={altId} className="block text-xs font-semibold text-text-secondary mb-1">
                      Alt text, offered when the image is picked again
                    </label>
                    <div className="flex gap-2">
                      <input
                        id={altId}
                        type="text"
                        value={draft}
                        maxLength={MEDIA_ALT_MAX}
                        onChange={(e) => setDrafts((d) => ({ ...d, [a.path]: e.target.value }))}
                        placeholder="Say what the image shows"
                        className={`flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border bg-bg-card text-sm ${draft.trim() ? 'border-border' : 'border-amber-500'}`}
                      />
                      <button
                        type="button"
                        onClick={() => saveAlt(a)}
                        disabled={pending || draft === a.alt}
                        className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium disabled:opacity-40"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <div className="text-xs">
                    <p className="font-semibold text-text-secondary mb-1">Used by</p>
                    {a.uses.length === 0 ? (
                      <p className="text-text-secondary">Nothing yet.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {a.uses.map((u) => (
                          <li key={`${u.kind}-${u.postId}`}>
                            <span className="text-text-secondary">{USE_LABEL[u.kind]}: </span>
                            {u.kind === 'testimonial' ? (
                              <Link className="underline" href={`/admin/testimonials/${u.postId}/edit`}>
                                {u.title || 'Untitled'}
                              </Link>
                            ) : (
                              <Link className="underline" href={`/admin/posts/${u.postId}/edit`}>
                                {u.title || 'Untitled'}
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="mt-auto pt-2">
                    <button
                      type="button"
                      onClick={() => setConfirm(a)}
                      disabled={pending || a.deleteRefusal !== null}
                      title={a.deleteRefusal ?? undefined}
                      className="text-sm font-medium text-red-600 disabled:text-text-secondary disabled:opacity-60"
                    >
                      Delete
                    </button>
                    {a.deleteRefusal && <p className="text-xs text-text-secondary mt-1">{a.deleteRefusal}</p>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-center gap-3 mt-6 text-sm">
          <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} className="px-3 py-1.5 rounded border border-border disabled:opacity-40">
            Previous
          </button>
          <span>
            Page {current + 1} of {pages}
          </span>
          <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} className="px-3 py-1.5 rounded border border-border disabled:opacity-40">
            Next
          </button>
        </nav>
      )}

      {confirm && (
        <ConfirmDialog
          title="Delete this image?"
          description={`${confirm.path} will be removed from storage. Nothing uses it now. This cannot be undone.`}
          confirmLabel="Delete image"
          confirmTone="danger"
          pending={pending}
          onConfirm={() => remove(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
