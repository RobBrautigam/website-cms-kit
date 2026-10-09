'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ModalShell from './ModalShell'
import AdminImage from './AdminImage'
import { createClient } from '@/lib/supabase/client'
import { IMAGE_ACCEPT, uploadBlogImage } from '@/lib/admin/upload-image'
import { imagePathFromUrl } from '@/lib/staging/images'
import { listMediaForPicker, type PickerAsset } from '@/app/(admin)/admin/media/actions'

export type PickedImage = { url: string; alt: string; path: string | null }

/**
 * Pick an image already in the media library, or upload a new one (1.5.0).
 * A picked image is reused as is: its final public URL goes into the
 * content, no second upload, and the alt text kept for it is handed back for
 * the caller to offer (each post still keeps its own copy).
 */
export default function MediaPicker({ onPick, onClose }: { onPick: (image: PickedImage) => void; onClose: () => void }) {
  const [assets, setAssets] = useState<PickerAsset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    listMediaForPicker().then((r) => {
      if (!live) return
      if (r.ok) setAssets(r.data ?? [])
      else setError(r.error)
    })
    return () => {
      live = false
    }
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = assets ?? []
    return (q ? list.filter((a) => a.alt.toLowerCase().includes(q) || a.path.includes(q)) : list).slice(0, 60)
  }, [assets, query])

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const result = await uploadBlogImage(createClient(), file)
      if ('error' in result) {
        setError(result.error)
        return
      }
      onPick({ url: result.url, alt: '', path: imagePathFromUrl(result.url) })
    } catch {
      setError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      ariaLabelledBy="media-picker-title"
      panelClassName="bg-bg-white border border-border rounded-2xl p-5 w-full max-w-3xl shadow-xl max-h-[85vh] flex flex-col"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 id="media-picker-title" className="text-lg font-bold">
          Choose an image
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : 'Upload new'}
          </button>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-sm">
            Cancel
          </button>
        </div>
        <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} onChange={upload} className="hidden" />
      </div>
      <label htmlFor="media-picker-search" className="sr-only">
        Search by alt text
      </label>
      <input
        id="media-picker-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by alt text"
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-sm mb-4"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600 mb-3">
          {error}
        </p>
      )}
      <div className="overflow-y-auto -mx-1 px-1">
        {assets === null && !error ? (
          <p className="text-sm text-text-secondary py-8 text-center">Loading the library...</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-text-secondary py-8 text-center">No images yet. Upload one.</p>
        ) : (
          <ul className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
            {shown.map((a) => (
              <li key={a.path}>
                <button
                  type="button"
                  onClick={() => onPick({ url: a.url, alt: a.alt, path: a.path })}
                  className="w-full text-left rounded-lg border border-border overflow-hidden hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <AdminImage src={a.url} alt={a.alt || 'No alt text yet'} className="w-full aspect-square object-cover bg-bg-card" loading="lazy" />
                  <span className="block px-2 py-1.5 text-xs truncate">
                    {a.alt || <span className="text-amber-700">No alt text yet</span>}
                  </span>
                  {a.state === 'private' && <span className="block px-2 pb-1.5 text-[11px] text-text-secondary">Private until its post goes live</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  )
}
