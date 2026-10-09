'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { restoreRevision } from '@/app/(admin)/admin/staging/actions'

export interface RevisionRow {
  id: string
  seq: number
  title: string
  status: string
  changedFields: string[]
  savedAt: string
  savedBy: string
}

const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  slug: 'address',
  excerpt: 'excerpt',
  featured_image_url: 'featured image',
  featured_image_alt: 'image alt text',
  body: 'body',
  categories: 'categories',
  meta_description: 'meta description',
  author_slug: 'author',
  status: 'status',
  published_at: 'publish date',
  unpublish_at: 'end date',
}

/**
 * Every save of a live or scheduled post keeps a revision (migration 003,
 * section 20): who, when, and which fields changed. Restore puts that
 * version into the staged copy, so it goes live the way any edit does
 * (docs/12). The latest 100 per post are kept.
 */
export default function RevisionsPanel({ revisions, hasStagedCopy }: { revisions: RevisionRow[]; hasStagedCopy: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function restore(id: string) {
    setBusy(id)
    setMessage(null)
    const result = await restoreRevision(id)
    setBusy(null)
    if (!result.ok) {
      setMessage(result.error)
      return
    }
    router.push('/admin/staging')
    router.refresh()
  }

  return (
    <section aria-labelledby="revisions-heading" className="rounded-lg border border-border p-4">
      <h2 id="revisions-heading" className="text-sm font-bold text-text-primary">Revisions</h2>
      {revisions.length === 0 ? (
        <p className="text-xs text-text-secondary mt-2">No revisions yet. Each save of this post once it is live or scheduled keeps one.</p>
      ) : (
        <ol className="mt-2 divide-y divide-border">
          {revisions.map((r) => (
            <li key={r.id} className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-text-primary truncate">{r.title}</p>
                <p className="text-xs text-text-secondary">
                  <time dateTime={r.savedAt}>{new Date(r.savedAt).toLocaleString()}</time> by {r.savedBy}
                  {r.changedFields.length > 0 && <>. Changed: {r.changedFields.map((f) => FIELD_LABELS[f] ?? f).join(', ')}</>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => restore(r.id)}
                disabled={busy !== null || hasStagedCopy}
                title={hasStagedCopy ? 'Publish or discard the staged change first.' : undefined}
                className="shrink-0 text-xs font-bold text-accent hover:underline disabled:opacity-50 disabled:no-underline"
              >
                {busy === r.id ? 'Restoring...' : 'Restore'}
              </button>
            </li>
          ))}
        </ol>
      )}
      {hasStagedCopy && revisions.length > 0 && (
        <p className="text-xs text-text-secondary mt-2">This post has a staged change. Publish or discard it before restoring.</p>
      )}
      {message && <p role="alert" className="text-xs text-red-600 mt-2">{message}</p>}
    </section>
  )
}
