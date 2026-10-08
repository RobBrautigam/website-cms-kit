/**
 * The edit screen's unsaved-changes tracking and server autosave.
 *
 * Where an autosave goes depends on the post, so it never changes what the
 * public sees:
 *   - a draft (or scheduled) post: its own row, content fields only, never
 *     its status;
 *   - a live post: its staged copy (docs/10), never the live row; a change
 *     already sent for review is left alone, since autosaving into it would
 *     change what the reviewer is approving;
 *   - a new post: this browser only, until the first save creates the row.
 */

export const AUTOSAVE_DELAY_MS = 4000

export type AutosaveTarget = 'draft' | 'staged' | 'browser' | 'paused'

export function autosaveTarget(opts: {
  postId?: string | null
  isLive: boolean
  stagedReviewStatus?: 'staged' | 'in_review' | 'approved' | null
}): AutosaveTarget {
  if (!opts.postId) return 'browser'
  if (!opts.isLive) return 'draft'
  if (opts.stagedReviewStatus === 'in_review' || opts.stagedReviewStatus === 'approved') return 'paused'
  return 'staged'
}

/** A stable fingerprint of the content, independent of key order. */
export function snapshot(value: unknown): string {
  const seen = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(seen)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, seen((v as Record<string, unknown>)[k])])
      )
    }
    return v
  }
  return JSON.stringify(seen(value))
}

export function isDirty(savedSnapshot: string, current: unknown): boolean {
  return snapshot(current) !== savedSnapshot
}

export function autosaveLabel(state: {
  target: AutosaveTarget
  dirty: boolean
  saving: boolean
  savedAt: Date | null
  error: string | null
}): string {
  if (state.saving) return 'Saving…'
  if (state.error) return `Not saved: ${state.error}`
  if (state.target === 'browser') return state.dirty ? 'Unsaved (kept in this browser)' : 'New post'
  if (state.target === 'paused') return state.dirty ? 'Unsaved: autosave is paused while this change is in review' : 'In review'
  if (state.dirty) return 'Unsaved changes'
  if (!state.savedAt) return 'All changes saved'
  const time = state.savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return state.target === 'staged' ? `Saved to the staged copy at ${time}` : `Draft saved at ${time}`
}
