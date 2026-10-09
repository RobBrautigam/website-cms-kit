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
 *   - not in the staged bucket but public (uploaded before 1.3.0 straight to
 *     the public bucket): skipped, and the fresh claim is dropped;
 *   - in neither bucket: refused, and the claim is kept (1.5.0), so a file
 *     uploaded at that path later is never promoted;
 *   - claimed before and public: promoted (a retry after the staged copy's
 *     removal failed); claimed before and not public yet: refused without
 *     touching the staged copy, which another request may be copying;
 *   - already public, and the kit did not put it there: refused, because that
 *     object never went through review.
 *
 * Returns null when every image is public, or the message to show.
 */
export async function promoteImages(
  content: { featured_image_url?: unknown; body?: unknown },
  postId: string
): Promise<string | null> {
  return promoteImagePaths(imagePathsIn(content), postId)
}

/**
 * The same promotion for a list of paths. Testimonials use it (1.5.0): their
 * pictures upload into the same staged bucket and go public when the
 * testimonial is saved, since testimonials save live. The ledger's post_id
 * then holds the testimonial's id.
 */
export async function promoteImagePaths(paths: string[], postId: string): Promise<string | null> {
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
    // The kit claimed this path already. Never copy it again: if the public
    // file is gone, a new staged upload at the same path would be an
    // unreviewed swap. The leftover staged copy is cleaned up only once the
    // public copy exists; until then another request may still be copying it
    // (1.5.0 review: removing it then lost the image).
    if (claimedBefore) {
      const { data: isPublic } = await storage.from(PUBLIC_BUCKET).exists(path)
      if (isPublic !== true) {
        return `An image is still being made public, or its public file was removed (${path}). Try again in a minute; if it stays, upload the image again.`
      }
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
      // Not staged. A public file from before 1.3.0 is served as it is and not
      // adopted into the ledger. A file that exists nowhere keeps its claim
      // (1.5.0 review), so nothing uploaded at that path after the post's
      // approval can ever be copied into its place.
      const { data: isPublic } = await storage.from(PUBLIC_BUCKET).exists(path)
      if (isPublic === true) {
        await drop()
        continue
      }
      return `An image the post names does not exist (${path}), so it was not made public. Upload the image again; it gets a new name.`
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
