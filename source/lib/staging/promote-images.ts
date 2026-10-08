import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { PUBLIC_BUCKET, STAGED_BUCKET, imagePathsIn } from './images'

/**
 * Make a post's staged images public, just before the post goes live: each
 * file is copied from the private staged bucket to the public one under the
 * same path (the URL the content already holds), then the staged copy is
 * removed. Runs on the service role, after the caller's own admin check.
 *
 * A path that is not in the staged bucket is skipped: it was promoted
 * already, or it was uploaded before 1.3.0 straight to the public bucket.
 * Any other failure stops the publish, so a post never goes live with an
 * image that does not load.
 */
export async function promoteImages(content: { featured_image_url?: unknown; body?: unknown }): Promise<string | null> {
  const paths = imagePathsIn(content)
  if (paths.length === 0) return null
  const storage = createServiceClient().storage
  const promoted: string[] = []
  for (const path of paths) {
    const { error } = await storage.from(STAGED_BUCKET).copy(path, path, { destinationBucket: PUBLIC_BUCKET })
    if (!error) {
      promoted.push(path)
      continue
    }
    const message = error.message ?? ''
    if (/not.?found|does not exist/i.test(message)) continue
    if (/already exists|duplicate/i.test(message)) {
      promoted.push(path)
      continue
    }
    return `An image could not be made public (${message}). Nothing was published; try again.`
  }
  if (promoted.length > 0) {
    const { error } = await storage.from(STAGED_BUCKET).remove(promoted)
    // The public copies exist, so the post is fine; a leftover staged copy is
    // only storage, and the next publish of the post tries the removal again.
    if (error) console.error('promoteImages: staged copies not removed', error.message)
  }
  return null
}
