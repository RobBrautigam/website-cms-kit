import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { PUBLIC_BUCKET, STAGED_BUCKET, imagePathsIn } from './images'

/**
 * Make a post's staged images public, right AFTER the post's publish write
 * succeeded (1.4.0; before, it ran first, so a publish the lock refused could
 * still leave its images public). Each file is copied from the private staged
 * bucket to the public one under the same path (the URL the content already
 * holds), then the staged copy is removed. Runs on the service role, after
 * the caller's own admin check.
 *
 * Every promotion is claimed in a ledger first (blog_image_promotions,
 * migration 003, section 22), so the kit can tell its own public copies from
 * an object somebody wrote into the public bucket directly:
 *   - copied: promoted;
 *   - not in the staged bucket: skipped (promoted already, or uploaded before
 *     1.3.0 straight to the public bucket); a fresh claim is dropped;
 *   - already public, and the ledger says the kit put it there: promoted (a
 *     retry after the staged copy's removal failed);
 *   - already public, and the kit did not put it there: refused, because that
 *     object never went through review.
 *
 * Returns null when every image is public, or the message to show.
 */
export async function promoteImages(
  content: { featured_image_url?: unknown; body?: unknown },
  postId: string
): Promise<string | null> {
  const paths = imagePathsIn(content)
  if (paths.length === 0) return null
  const svc = createServiceClient()
  const storage = svc.storage
  const ledger = () => svc.from('blog_image_promotions')
  const promoted: string[] = []
  for (const path of paths) {
    const claim = await ledger().insert({ path, post_id: postId })
    const claimedBefore = claim.error?.code === '23505'
    if (claim.error && !claimedBefore) {
      return `An image could not be made public (the promotion ledger: ${claim.error.message}). Check that migration 003 has run.`
    }
    // The kit made this path public once already. Never copy it again: if the
    // public file is gone, a new staged upload at the same path would be an
    // unreviewed swap. Only the leftover staged copy is cleaned up.
    if (claimedBefore) {
      promoted.push(path)
      continue
    }
    const drop = async () => {
      await ledger().delete().eq('path', path)
    }
    const { error } = await storage.from(STAGED_BUCKET).copy(path, path, { destinationBucket: PUBLIC_BUCKET })
    if (!error) {
      promoted.push(path)
      continue
    }
    const message = error.message ?? ''
    if (/not.?found|does not exist/i.test(message)) {
      await drop()
      continue
    }
    if (/already exists|duplicate/i.test(message)) {
      await drop()
      return `An image is already public but was not made public by the kit (${path}). Remove it from the public bucket, or upload the image again.`
    }
    await drop()
    return `An image could not be made public (${message}).`
  }
  if (promoted.length > 0) {
    const { error } = await storage.from(STAGED_BUCKET).remove(promoted)
    // The public copies exist, so the post is fine; a leftover staged copy is
    // only storage, and the next promotion of the post tries the removal again.
    if (error) console.error('promoteImages: staged copies not removed', error.message)
  }
  return null
}
