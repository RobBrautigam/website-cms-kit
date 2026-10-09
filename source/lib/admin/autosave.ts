/**
 * The edit screen's unsaved-changes tracking and server autosave.
 *
 * Where an autosave goes depends on the post, so it never changes what the
 * public sees:
 *   - a post with a staged copy, live or not: the staged copy (docs/10),
 *     since that is what the editor opened and what will be published; a
 *     change already sent for review is left alone, since autosaving into it
 *     would change what the reviewer is approving;
 *   - a live post: its staged copy, never the live row;
 *   - a scheduled post: its staged copy too (1.4.0); it goes live on its own
 *     at its date, so half-typed text must never land in the row itself;
 *   - a draft: its own row, content fields only, never its status;
 *   - a new post: this browser only, until the first save creates the row.
 *
 * An explicit save and an autosave never race: `createSaveGate()` makes the
 * save wait for an autosave already in flight, and starts no autosave while
 * the save runs.
 */

export const AUTOSAVE_DELAY_MS = 4000

export type AutosaveTarget = 'draft' | 'staged' | 'browser' | 'paused' | 'off'

export function autosaveTarget(opts: {
  postId?: string | null
  isLive: boolean
  isScheduled?: boolean
  stagedReviewStatus?: 'staged' | 'in_review' | 'approved' | null
}): AutosaveTarget {
  if (!opts.postId) return 'browser'
  if (opts.stagedReviewStatus === 'in_review' || opts.stagedReviewStatus === 'approved') return 'paused'
  if (opts.stagedReviewStatus === 'staged' || opts.isLive || opts.isScheduled) return 'staged'
  return 'draft'
}

export type SaveGate = {
  /** Runs `write` unless an autosave is in flight or a save holds the gate. Resolves true when it ran. */
  autosave(write: () => Promise<unknown>): Promise<boolean>
  /** Waits for an autosave in flight, then holds the gate until `endSave()`. */
  beginSave(): Promise<void>
  /** Opens the gate again (after a failed save, or when the editor stays open). */
  endSave(): void
  readonly busy: boolean
}

export function createSaveGate(): SaveGate {
  let inFlight: Promise<unknown> | null = null
  let saving = false
  return {
    async autosave(write) {
      if (inFlight || saving) return false
      const run = write()
      inFlight = run
      try {
        await run
      } finally {
        inFlight = null
      }
      return true
    },
    async beginSave() {
      saving = true
      if (inFlight) await inFlight.catch(() => {})
    },
    endSave() {
      saving = false
    },
    get busy() {
      return inFlight !== null
    },
  }
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
  if (state.target === 'off') return state.dirty ? 'Unsaved changes: a scheduled post saves when you press Update' : 'Scheduled'
  if (state.dirty) return 'Unsaved changes'
  if (!state.savedAt) return 'All changes saved'
  const time = state.savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return state.target === 'staged' ? `Saved to the staged copy at ${time}` : `Draft saved at ${time}`
}
