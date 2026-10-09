/**
 * When a scheduled post's images go public (1.5.0, review finding 8 of 1.4.0).
 *
 * The database scheduler (run_scheduled_publishing, migration 003) cannot
 * copy files: in Supabase, objects move only through the Storage API. So by
 * default a scheduled post's images are made public when the post is
 * scheduled, and the post itself waits for its date.
 *
 * SCHEDULED_IMAGES=at_publish keeps them private until the date instead. A
 * server job then has to run every minute (app/api/cron/scheduled-publishing,
 * called by Supabase Cron through pg_net, docs/12): it copies the images of
 * every scheduled post due within the lead time, then runs the scheduler.
 * Without that job the images of a post that goes live would not load, which
 * is why the setting is off unless you turn it on.
 */

/** The job copies images this far ahead of the date, so a job running every minute is never late. */
export const SCHEDULED_IMAGE_LEAD_SECONDS = 120

/** Read at call time, so a deploy's environment decides. */
export function imagesAtPublishDate(): boolean {
  return process.env.SCHEDULED_IMAGES === 'at_publish'
}

/** True when a post's images should stay private for now: it is scheduled beyond the lead time. */
export function imagesWaitForDate(post: { status?: unknown; published_at?: unknown }, now: Date = new Date()): boolean {
  if (!imagesAtPublishDate() || post.status !== 'scheduled') return false
  const at = Date.parse(String(post.published_at ?? ''))
  return Number.isFinite(at) && at - now.getTime() > SCHEDULED_IMAGE_LEAD_SECONDS * 1000
}

/** The latest publish date whose images the job copies on this run. */
export function scheduledImagesCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() + SCHEDULED_IMAGE_LEAD_SECONDS * 1000).toISOString()
}
