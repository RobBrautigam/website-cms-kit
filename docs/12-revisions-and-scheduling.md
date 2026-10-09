# 12 - Revisions and Scheduled Publishing

1.4.0 adds a history to every live post and lets a post go live, and come down, on its own. Both live in `source/supabase/migrations/003_revisions_and_scheduling.sql`; run it after 002 (and again after re-running 000, 001 or 002). The same migration finishes the two-person lock ([docs/10](10-staging-and-approval.md)): images and redirects are inside it now.

## Revisions

**What is kept.** Every save of a post that is live or scheduled, or was a moment ago, writes a row to `blog_post_revisions`: the nine content fields, the status and both dates, the admin who saved it (`saved_by`, null for the scheduler), the time, and `changed_fields`, the list of fields that differ from the version before. A draft's autosaves make none; a draft is not public, so its history would be noise.

**How.** An `AFTER INSERT OR UPDATE` trigger on `blog_posts` (`blog_posts_keep_revision()`), so a change made through the editor, the Staging page, a bulk action, the Data API or the scheduler is kept the same way. It runs `SECURITY DEFINER`: admins can read revisions but never write or delete them. Revisions have no foreign key to their post, so deleting a post (an ordinary admin right) keeps its history. The latest 100 per post are kept (`blog_post_revisions_kept()`; change the number there).

**Restoring.** The Revisions panel on a live or scheduled post's edit screen lists the latest 20. **Restore** copies that version into the post's staged copy and sends you to Staging; from there it goes live the way any edit does: Publish when review is off, a teammate's approval when it is on. The live post is not touched by the restore itself, and a restore is refused while the post already has a staged change, so it never overwrites work in progress or a change in review. Each restore writes an audit row (`blog_post.restore_revision`).

## Scheduled publishing

**Publish at.** A post saved as Scheduled with a date goes live at that date. Two things make that true:

1. **Visitors see it from that minute.** The public read policy on `blog_posts` admits a scheduled post once its date has passed, so a site that renders on each request shows it on time even if the scheduler is late. (Before 1.4.0 a scheduled post stayed invisible forever: nothing ever changed its status.)
2. **The scheduler makes it a published post.** `run_scheduled_publishing()` sets every due scheduled post to Published, which keeps a revision and writes an audit row (`blog_post.scheduled_publish`, actor `scheduler`).

**Comes down at.** Any live or scheduled post can have an end date (`unpublish_at`, the Schedule panel's "Comes down at"). From that minute visitors no longer see it, and the scheduler sets it back to Draft and clears the date (`blog_post.scheduled_unpublish`). The end date must be after the publish date (a check constraint).

**Editing a scheduled post.** It takes the staged path, like a live post: edits wait in the staged copy (autosave included) and **Apply to scheduled post** publishes the staged copy into the scheduled post without changing its date. Under required review that apply needs a teammate's approval, the same as a live post.

**What the lock allows without review.** Pushing a scheduled date later and setting or changing an end date only ever keep a post off the site longer, so they are free. Moving a date earlier, or anything that changes content, goes through the staged copy.

**Times are UTC.** The date fields say so. Supabase Cron runs in UTC too ([pg_cron docs](https://supabase.com/docs/guides/cron), read 2026-10-08).

## Running the scheduler

**The kit's pick: Supabase Cron (`pg_cron`).** It runs inside the database that holds the posts, so a publish needs no app server, no secret leaving the database and no extra service; Supabase ships it as the Cron integration, every plan has it, and a job is one SQL call. The alternative below exists for hosts that keep jobs outside the database.

1. Dashboard -> Integrations -> Cron -> enable (or `create extension if not exists pg_cron;`).
2. Re-run `003_revisions_and_scheduling.sql`. Its last block schedules the job when pg_cron is present:

   ```sql
   select cron.schedule('cms-kit-scheduled-publishing', '* * * * *', 'select public.run_scheduled_publishing()');
   ```

   Re-running replaces the job by name. To stop it: `select cron.unschedule('cms-kit-scheduled-publishing');`
3. Check it: `select * from cron.job_run_details order by start_time desc limit 5;` and the audit log's Revisions and scheduling filter.

**The host's scheduler instead.** Call the function every minute with the service role key, from your host's cron (Railway, Render, Fly, a GitHub Actions schedule):

```bash
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/run_scheduled_publishing" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

It answers `{"published": n, "unpublished": n}`. Only the service role may run it.

**Cached public pages.** The scheduler changes rows; Next.js does not hear about it. A public page rendered on each request is correct at once. A statically rendered or ISR page shows the change at its next revalidation, so give blog pages a short `export const revalidate = 60` (one minute, the scheduler's own step), or render them dynamically.

**Images of a scheduled post.** They are made public when the post is scheduled (right after that save succeeds), because the scheduler runs in the database and cannot copy storage objects. Their addresses are long random names that nothing links to until the post is live.

## How other CMSs do it (read 2026-10-08)

- **Payload** keeps versions in a separate versions table, writes one on every save when versions are on, caps them per document (`maxPerDoc`), and schedules publish and unpublish as jobs in its own queue, run by a worker or an external cron.
- **Keystatic** and **Decap** keep content in Git, so history is the commit log and there is no built-in scheduler; scheduling is a CI job that merges or commits at a time.

The kit follows Payload's shape (a versions table written on save, a per-post cap, a scheduled job) and puts both halves in Postgres, where the posts and the lock already live.
