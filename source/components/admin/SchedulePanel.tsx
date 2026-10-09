'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateSchedule } from '@/app/(admin)/admin/staging/actions'

/**
 * When a live or scheduled post goes live and comes down (docs/12). The
 * scheduler (pg_cron, or the host's scheduler) publishes a scheduled post at
 * its date and takes a post down at its end date. Pushing a date later or
 * setting an end date is always allowed; under required review, an earlier
 * publish date goes through the staged copy instead.
 */
export default function SchedulePanel({
  postId,
  status,
  publishedAt,
  unpublishAt,
}: {
  postId: string
  status: 'published' | 'scheduled'
  /** datetime-local values, or '' */
  publishedAt: string
  unpublishAt: string
}) {
  const router = useRouter()
  const [publishAt, setPublishAt] = useState(publishedAt)
  const [takeDownAt, setTakeDownAt] = useState(unpublishAt)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setMessage(null)
    const result = await updateSchedule(postId, {
      ...(status === 'scheduled' ? { publishAt } : {}),
      unpublishAt: takeDownAt,
    })
    setSaving(false)
    setMessage(result.ok ? 'Schedule saved.' : result.error)
    if (result.ok) router.refresh()
  }

  return (
    <section aria-labelledby="schedule-heading" className="rounded-lg border border-border p-4 space-y-3">
      <h2 id="schedule-heading" className="text-sm font-bold text-text-primary">Schedule</h2>
      {status === 'scheduled' && (
        <div>
          <label htmlFor="schedule-publish-at" className="block text-xs font-semibold text-text-secondary mb-1">Goes live at (UTC)</label>
          <input
            id="schedule-publish-at"
            type="datetime-local"
            value={publishAt}
            onChange={(e) => setPublishAt(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary text-sm"
          />
        </div>
      )}
      <div>
        <label htmlFor="schedule-unpublish-at" className="block text-xs font-semibold text-text-secondary mb-1">Comes down at (UTC, optional)</label>
        <input
          id="schedule-unpublish-at"
          type="datetime-local"
          value={takeDownAt}
          onChange={(e) => setTakeDownAt(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary text-sm"
        />
        <p className="text-xs text-text-secondary mt-1">At this time the post goes back to draft. Leave it empty to keep the post up.</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg border border-accent text-accent text-sm font-bold hover:bg-accent/5 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save schedule'}
        </button>
        {message && <span role="status" className="text-xs text-text-secondary">{message}</span>}
      </div>
    </section>
  )
}
