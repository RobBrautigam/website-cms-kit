/**
 * Staged images nothing uses.
 *
 * An upload lands in the private staged bucket the moment it is picked, so an
 * image removed from a post before it went live, or a post deleted while it
 * waited, leaves its file behind. Settings has a "Clean up staged images"
 * button for the super admin (lib/admin/staging-actions.ts
 * cleanupStagedImages): it lists the staged bucket, keeps every path any post
 * or staged copy still holds, and removes the rest once they are older than
 * the grace period, so an image picked in an editor that has not saved yet is
 * never taken.
 */

import { isImagePath } from './images'

/** Long enough for an editor left open overnight to save its first draft. */
export const ORPHAN_MIN_AGE_HOURS = 48

/** The `blog/<name>` paths to remove. */
export function planOrphanCleanup(
  objects: { name: string; created_at: string | null }[],
  referencedPaths: string[],
  now: Date = new Date()
): string[] {
  const keep = new Set(referencedPaths)
  const cutoff = now.getTime() - ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000
  const remove: string[] = []
  for (const o of objects) {
    const path = `blog/${o.name}`
    if (!isImagePath(path) || keep.has(path) || !o.created_at) continue
    const created = Date.parse(o.created_at)
    if (Number.isNaN(created) || created > cutoff) continue
    remove.push(path)
  }
  return remove
}
