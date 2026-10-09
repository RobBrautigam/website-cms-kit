# 13 - The Media Library

1.5.0 adds one screen for every image the kit holds, alt text kept per image and offered when you use it again, and a rule that an image in use is never deleted. It lives in `source/supabase/migrations/004_media_library.sql`; run it after 003, and again after re-running 000, 002 or 003 (they recreate the delete policies 004 replaces). The same release adds an optional server job for the images of scheduled posts ([below](#the-images-of-a-scheduled-post)).

## What the screen shows

**Media** in the sidebar (`/admin/media`) lists every object under `blog/` in both image buckets, newest first, 48 a page:

| Badge | Meaning |
|---|---|
| **Private** | In the private `blog-images-staged` bucket only: uploaded, and no post using it has gone live yet. |
| **Public** | In the public `blog-images` bucket with a row in the promotion ledger (`blog_image_promotions`): the kit made it public when its post went live, on the date shown. |
| **Not promoted by the kit** | In the public bucket with no ledger row: uploaded before 1.3.0 straight to the public bucket, or written there by something other than the kit. The kit keeps serving it where content already uses it and never adopts it into a new publish. |
| **Leftover staged copy** | A public image whose private copy is still there (its removal failed after the copy); the next promotion of its post removes it. |

Each card shows the path, the alt text with a Save button, and **Used by**: every live post, staged change, kept revision and testimonial that names the image, each linked to its edit screen. Filters: All, Private, Public, Unused, Missing alt text. Upload adds an image to the private bucket, the same way the editor does.

The page reads with the service role after `requireAdmin()` (`lib/media/load.ts`), so it sees every bucket listing, ledger row and content row; the rules below live in the database and the server actions, never in the page.

## The rules

| Rule | Where it is enforced | Tests (each seen failing first) |
|---|---|---|
| **Alt text is kept per image.** One row per image in `blog_media` (path, alt text, who first saved it, who changed it and when; the uploader is the storage object's owner). Admins may insert a path with its alt text and change the alt text; a trigger stamps who and when, so neither can be forged; nobody deletes a row by hand. Only the kit's own paths, at most 200 characters, cleaned on the server. | `blog_media` RLS and column grants, `saveMediaAlt` | `media.test.mjs`: four "alt text per asset" tests; `media-actions.test.mjs`: the first test |
| **The kept alt text is offered on reuse.** Picking an image in the editor prefills the alt text prompt with it; picking a featured image fills the featured alt field only when it is still empty. The first alt text given for an image that had none is saved back to the library. The alt text in a post stays per use (the image node's `alt`, the featured image's alt field), so one post can still describe the same image differently. | `MediaPicker`, `PostEditor`, `ImageUploader` | `media-actions.test.mjs`: "the library ... the picker offers each asset with its alt" |
| **An image is reused without a second upload.** The picker inserts the image's existing address. The ledger claims a path once, so when a second post using it goes live the claim is already there and nothing is copied again. | `listMediaForPicker`, `promoteImagePaths` | the library test; the ledger tests in `actions.test.mjs` |
| **An image in use is never deleted, overwritten or moved.** `blog_image_in_use(path)` looks for the address in live posts, staged changes, kept revisions (a Restore could bring it back) and testimonials. Both buckets' delete and update policies call it, so the Storage API refuses a delete, an overwrite or a move for any admin client; the server action asks it first and refuses before touching storage, and a failed check refuses too. The check reads private text as its owner, so it answers only an active admin with two-factor done, and only for a kit path: anyone else, or any other text, gets "in use", which leaves nothing to probe. | migration 004 section 24, `deleteMediaAsset` | `media.test.mjs`: the two "cannot delete" tests, "cannot be overwritten or moved", the revision and testimonial tests, "tells nothing to a signed-in outsider"; `media-actions.test.mjs`: the two "never deleted" tests |
| **Staged images stay write-once under review.** With review required, the staged bucket's delete policy still refuses every admin, used or not; the action says so when nothing was removed and keeps the alt text. | migration 004, `deleteMediaAsset` | `media.test.mjs`: "review required: a staged image stays write-once"; `media-actions.test.mjs`: "the storage policy decides" |
| **The promotion ledger stays the only door to the public bucket.** Nothing in 004 grants a write to the public bucket; an alt text row opens no door; deleting a public image keeps its ledger row, so a later upload at the same path is never copied into its place. Two gaps closed in review: a path the post names that exists in neither bucket keeps its claim (before, the claim was dropped, so a file uploaded there after approval could be promoted), and a request that finds a path already claimed leaves the staged file alone until the public copy exists (before, it could remove the file another request was still copying). | migration 003 section 22, `promoteImagePaths`, `deleteMediaAsset` | `media.test.mjs`: "an alt text record opens no door"; `media-actions.test.mjs`: "deleting an unused public image keeps its ledger row", "a path that exists in neither bucket keeps its claim", "a claim another request still holds" |
| **A testimonial never publishes a post's image.** A testimonial's own images go public when it is saved; an image a post, staged change or revision uses is left to its post (review, a scheduled date), and the save says so. | `blog_image_in_posts()` (the server only), `publishTestimonialImages` | `media.test.mjs`: "the posts-only check"; `media-actions.test.mjs`: "a testimonial save never makes a post's image public" |
| **The orphan cleanup keeps its rules.** Settings' cleanup still removes only staged images older than 48 hours that nothing uses, on the service role. It now also reads testimonials, and asks the database's in-use check before each removal, so a file named only in a link or a resized-image address is kept; a failed check keeps the file. | `cleanupStagedImages` | `media.test.mjs`: "the server still removes any file"; `media-actions.test.mjs`: "the staged-image cleanup keeps a file a testimonial uses", "the cleanup asks the database's in-use check too" |

The pure logic (what counts as a use on the screen, the delete refusal, how both buckets and the ledger become one list) is in `lib/media/library.ts` with its own tests in `library.test.mjs`. The screen's Used by list reads image fields and image nodes; the database's check also matches the address anywhere in a body, so it can refuse a delete the screen allowed. The database's answer is the one that counts. The editor's picker reads only the two buckets, the ledger and the alt text, never the content tables.

**An image uploaded in the library and never used** is still an unused staged image: the cleanup removes it after 48 hours, as before. Use it in a post, or it goes.

**Taking an image down at once.** Deleting is refused while anything uses it. Remove the image from the post (or take the post down) first; a kept revision counts as a use until it ages out of the latest 100.

## Testimonial images: a fix

Since 1.3.0, uploads go to the private bucket, and only a post going live copied its images to the public one. Testimonials save straight to the live site and never went through that copy, so a new headshot, screenshot or video thumbnail pointed at a public address with no file behind it, and the 48-hour cleanup would have deleted the private copy. From 1.5.0 a testimonial's images are made public when it is saved, through the same ledger (an object the kit did not promote is still refused, and the save says so), and the cleanup and the in-use check both read testimonials. An image a post uses is never made public by a testimonial save: it waits for its post, and the save says so (upload a separate copy to show it on the testimonial now). Testimonials are outside the two-person lock, as before ([SECURITY.md](../SECURITY.md#known-limitations)).

## The images of a scheduled post

Before 1.5.0 a scheduled post's images were made public when it was scheduled, because the scheduler runs in the database and Postgres cannot copy storage files (deleting a row in `storage.objects` does not even remove the file; [Supabase Storage docs](https://supabase.com/docs/guides/storage/management/delete-objects), read 2026-10-09). They sat under long random names nothing linked to, but they were public before the post.

**The kit's pick: an optional server job, off by default.** Set `SCHEDULED_IMAGES=at_publish` and a scheduled post's images stay private until its date. A route, `POST /api/cron/scheduled-publishing`, called every minute with `Authorization: Bearer <CRON_SECRET>`, copies the images of every scheduled post due within the next two minutes through the same ledger, then runs `run_scheduled_publishing()`. Why this shape:

- **Files move only through the Storage API**, so the copy has to run in a server with the service role, not in the database.
- **Supabase's own pattern for a job that calls the app** is Supabase Cron with `pg_net` posting to an HTTP endpoint, the secret kept in Vault ([Supabase docs on scheduling functions](https://supabase.com/docs/guides/functions/schedule-functions), read 2026-10-09). Payload runs scheduled publishing the same way: a job in its own queue, run by a worker or an outside cron.
- **It is opt-in** so a site that never sets up the job never shows a scheduled post with broken images. Without the setting nothing changes.
- **Two minutes early, on purpose.** The public read policy shows a scheduled post the minute its date passes, before the scheduler marks it published, so the images have to be public by then. Copying them up to two minutes early keeps the post whole even when one run is late.

A post goes live at its date whatever happens to its images: a failed image is reported in the job's answer and in the server log, never a reason to hold the post. The editor's **Make images public** button on a waiting post says when they will go public instead of copying them early, and a publish that cannot read the post's schedule copies nothing and says so. The job also checks the posts published in the last 24 hours, so a post the database-only job published first still gets its images.

**One window it cannot close:** pushing a scheduled date later is free under the lock, and inside a post's last two minutes its images may already be public; a date pushed later then leaves them public, under their random names, until the new date. Move a date before its last two minutes.

**Setting it up.** In your host: `SCHEDULED_IMAGES=at_publish` and a `CRON_SECRET` of at least 32 random characters (`openssl rand -hex 32`). In Supabase: enable Cron and `pg_net`, keep the secret in Vault, and replace the database-only job from [docs/12](12-revisions-and-scheduling.md#running-the-scheduler) with one that calls the route:

```sql
select vault.create_secret('<the same CRON_SECRET>', 'cms_kit_cron_secret');

select cron.unschedule('cms-kit-scheduled-publishing');
select cron.schedule('cms-kit-scheduled-publishing', '* * * * *', $$
  select net.http_post(
    url := 'https://your-domain.com/api/cron/scheduled-publishing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cms_kit_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);
```

Re-running migration 003 schedules the database-only job again under the same name, so run the block above after any re-run of 003. A host cron works the same way: `curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/scheduled-publishing`.

The route checks the secret before it touches anything (503 when `CRON_SECRET` is missing or shorter than 32 characters, 401 for a wrong one, compared in constant time), reads no cookie and needs no session; the route scan in `request-origin.test.mjs` keeps it that way.

## How other CMSs do it (read 2026-10-09)

| CMS | Alt text | Reuse | Folders or tags | Deleting a used asset |
|---|---|---|---|---|
| **Payload** (MIT, 45k stars) | A field on the upload collection, so one alt text per asset | Upload and relationship fields point at the same media document | Folders, in beta | A plain delete operation; its upload docs name no check for uses (a `beforeDelete` hook can add one) |
| **Strapi** (73k stars) | Alt text and caption per asset; the library flags assets missing them | Media fields point at the same asset | Folders | Allowed; its docs warn that "the linked content breaks and image containers are left empty" |
| **Decap** and **Keystatic** (MIT) | Content and images are files in Git, so an image is picked by its path in the repository | | | |

The kit keeps alt text per asset like Payload and Strapi, offers it on reuse while each post keeps its own alt in the content, and refuses to delete a used image, which neither Payload nor Strapi does by default, because its content stores the image's final public address and a deleted file is a broken image on a live page.
