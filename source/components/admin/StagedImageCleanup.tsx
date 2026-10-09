'use client'

import { useState } from 'react'
import { cleanupStagedImages } from '@/app/(admin)/admin/staging/actions'
import { ORPHAN_MIN_AGE_HOURS } from '@/lib/staging/orphans'

/**
 * Settings, super admin only: remove staged images no post, staged copy or
 * revision uses, once they are older than the grace period
 * (lib/staging/orphans.ts).
 */
export default function StagedImageCleanup() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function run() {
    if (!window.confirm('Remove staged images nothing uses? Images in any post, staged copy or revision are kept.')) return
    setBusy(true)
    const result = await cleanupStagedImages()
    setBusy(false)
    setMessage(
      result.ok
        ? `Removed ${result.data?.removed ?? 0} unused staged image(s); kept ${result.data?.kept ?? 0}.`
        : result.error
    )
  }

  return (
    <div className="border border-border rounded-xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
      <p className="text-sm text-text-secondary">
        Remove staged images nothing uses (older than {ORPHAN_MIN_AGE_HOURS} hours, so an editor still open is safe).
      </p>
      <div className="flex items-center gap-3">
        {message && <span role="status" className="text-xs text-text-secondary">{message}</span>}
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="px-4 py-2 rounded-lg border border-border text-text-primary text-sm font-medium hover:bg-bg-card transition-colors disabled:opacity-50"
        >
          {busy ? 'Cleaning up...' : 'Clean up staged images'}
        </button>
      </div>
    </div>
  )
}
