import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { cronRefusal } from '@/lib/security/cron-secret'
import { promoteImages } from '@/lib/staging/promote-images'
import { scheduledImagesCutoff } from '@/lib/staging/scheduled-images'

/**
 * The scheduled-publishing job (1.5.0, docs/12-revisions-and-scheduling.md).
 * Called every minute by a scheduler (Supabase Cron through pg_net, or any
 * host cron) with `Authorization: Bearer <CRON_SECRET>`; no cookie, no
 * session. It copies the images of every scheduled post due within the lead
 * time through the promotion ledger (lib/staging/promote-images.ts, so an
 * object the kit did not promote is still refused), then runs the database
 * scheduler, which publishes due posts and takes down expired ones.
 *
 * Needed only with SCHEDULED_IMAGES=at_publish; without it a scheduled
 * post's images are already public and this job only runs the scheduler.
 */
const RECENTLY_PUBLISHED_MS = 24 * 60 * 60 * 1000

export async function POST(request: Request) {
  const refused = cronRefusal(request)
  if (refused) return refused

  const svc = createServiceClient()
  const { data: scheduled, error: scheduledError } = await svc
    .from('blog_posts')
    .select('id, title, featured_image_url, body')
    .eq('status', 'scheduled')
    .lte('published_at', scheduledImagesCutoff())
  // A post the database-only job (003) or anything else already published in
  // the last day: its images may still be private (1.5.0 review). Promotion
  // is idempotent, so a post whose images are public costs one check each.
  const { data: published, error: publishedError } = await svc
    .from('blog_posts')
    .select('id, title, featured_image_url, body')
    .eq('status', 'published')
    .gte('published_at', new Date(Date.now() - RECENTLY_PUBLISHED_MS).toISOString())
  const error = scheduledError ?? publishedError
  const due = [...(scheduled ?? []), ...(published ?? [])]
  // Failures answer with fixed text; the database's and storage's own
  // messages go to the server log only.
  if (error) {
    console.error('scheduled-publishing: could not read scheduled posts', error.message)
    return NextResponse.json({ error: 'Could not read scheduled posts. See the server log.' }, { status: 500 })
  }

  let imagesPromoted = 0
  const imageProblems: { id: string; title: string; error: string }[] = []
  for (const post of due) {
    const failed = await promoteImages(post, post.id as string)
    if (failed) {
      console.error('scheduled-publishing: images not public', post.id, failed)
      imageProblems.push({
        id: post.id as string,
        title: String(post.title ?? ''),
        error: /not made public by the kit/.test(failed)
          ? 'An image is already public but was not made public by the kit, so it was refused.'
          : 'An image could not be made public. See the server log.',
      })
    } else {
      imagesPromoted++
    }
  }

  // The post goes live at its date either way (the read policy shows a due
  // post), so a failed image is reported, never a reason to hold the post.
  const { data: ran, error: rpcError } = await svc.rpc('run_scheduled_publishing')
  if (rpcError) {
    console.error('scheduled-publishing: the scheduler failed', rpcError.message)
    return NextResponse.json({ imagesPromoted, imageProblems, error: 'The scheduler failed. See the server log.' }, { status: 500 })
  }
  const result = (ran ?? {}) as { published?: number; unpublished?: number }
  if ((result.published ?? 0) > 0 || (result.unpublished ?? 0) > 0) {
    revalidatePath('/blog', 'page')
    revalidatePath('/blog/[slug]', 'page')
  }
  return NextResponse.json({
    imagesPromoted,
    imageProblems,
    published: result.published ?? 0,
    unpublished: result.unpublished ?? 0,
  })
}
