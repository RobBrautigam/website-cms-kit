# Changelog

All notable changes to this kit. Dates are when the change landed on `main`.

## 1.4.0 (2026-10-08)

Revisions, scheduled publishing, and the fixes the 1.3.0 review left open. Run `003_revisions_and_scheduling.sql` after 002. Full detail in [docs/12](docs/12-revisions-and-scheduling.md).

### Added

- **Revisions.** Every save of a live or scheduled post keeps a revision (who, when, which fields changed), by trigger, so the editor, Staging, bulk actions, the Data API and the scheduler are all kept; the latest 100 per post. Admins read them; nobody writes them by hand.
- **Restore through staging.** The edit screen lists a post's revisions; Restore puts that version into the staged copy, so it goes live the way any edit does, review included.
- **Scheduled publish and take-down.** A scheduled post is visible from its date (it never was before: nothing changed its status) and `run_scheduled_publishing()` marks it published; any live or scheduled post can have an end date ("Comes down at"). Supabase Cron runs it every minute when pg_cron is enabled; the host's scheduler can call it instead. Each change keeps a revision and an audit row.
- **A Schedule panel** on live and scheduled posts, and the date fields say they are UTC (they were read in the browser's zone and saved as UTC, which moved a date on every save).
- **Staged image cleanup** in Settings (super admin): unused staged images older than 48 hours are removed, with an audit row.
- **A kit-local type-check** (`source/typecheck/`) against the Next.js 16.4 types, with no borrowed `node_modules`.
- `docs/12-revisions-and-scheduling.md`, and 41 more tests (174 in all): migration 003 on PGlite, the new route and action behavior against stand-ins, and the new helpers, each seen failing first.

### Security

- **The two-person lock is whole.** With review required: no admin writes to the public image bucket, staged images are write-once, and a new or changed redirect waits switched off until a teammate turns it on (the database records who changed it). A scheduled post's edits take the staged path, so the lock no longer blocks editing it, and pushing its date later or setting an end date stays free.
- **Images go public only after the publish write succeeds,** everywhere a post goes live, through a ledger of what the kit promoted: a file somebody put in the public bucket directly is refused, not adopted. A post that went live with an image still private says so and offers Make images public.
- **The redirect counter and the audit log key on the address the trusted proxy wrote** (`TRUSTED_PROXY_HOPS`), never the visitor's first `X-Forwarded-For` entry.
- **Password re-checks and recovery codes are limited per admin** (5 tries in 15 minutes each), and every wrong password, wrong code and limited try writes an audit row.
- **The AI routes:** the request is checked before any budget is spent, the inputs refuse unknown keys, a daily cap per admin (100 calls) sits behind the ten-minute limit, and every call leaves a spend record (`ai_usage`) with its token counts; no record, no call.
- **Live-post autosave is quiet and never resets a review:** it writes only a staged copy nobody has sent for review, and audits only the one that creates the copy. An explicit save waits for an autosave in flight.
- **HSTS defaults to `max-age` alone;** `HSTS_PRELOAD=1` adds `includeSubDomains; preload` (docs/09).
- **Session lifetime and idle timeout chosen and documented** (docs/09): a 12-hour time-box, a 2-hour idle timeout, a one-hour access token.

### Changed

- `APP_VERSION` reads `v1.4.0`.
- The 100 em dashes left in 52 older files are gone.
- SECURITY.md's known limitations: four closed, three added (the scheduler, the session settings, scheduled images).

## 1.3.0 (2026-10-08)

Hardening and everyday comforts. Run `002_hardening.sql` after 001. Full detail in [docs/11](docs/11-hardening-and-everyday-comforts.md).

### Security

- **Security headers ship with the kit.** A real `source/next.config.ts` sends HSTS, `nosniff`, a referrer policy, `X-Frame-Options: DENY`, a permissions policy and `Cross-Origin-Opener-Policy` on every response, and turns off `X-Powered-By`.
- **A Content Security Policy with a per-request nonce**, set by `proxy.ts`: report-only on the admin by default, with `CSP_MODE=enforce`, `CSP_SCOPE=site` and `CSP_REPORT_URI` to switch it.
- **One same-site check on every state-changing route.** The 17 older cookie-authorized routes (two-factor, user management, uploads, the AI routes, revalidation) now refuse a cross-site request before the auth check, through one shared helper, `lib/security/request-origin.ts`, which the preview routes use too. A test scans every route file for it.
- **The password before new recovery codes**, checked on a throwaway client like turning two-factor off.
- **Per-caller limits** kept in the database: the AI routes share 20 calls per admin in 10 minutes and refuse when the limiter is down; the redirect counter is counted by the server only, per visitor and per redirect, and the public key can no longer call `increment_redirect_hit`.
- **Schemas on the AI routes' output** (zod): a reply that does not fit, including a post body with a node the site does not draw or a link or image address that could run script, is a 502, never handed to the editor. Inputs are validated too, and errors no longer echo internal details.
- **The audit log is append-only by trigger**: updates, deletes and truncates are refused for every role, the service role included, apart from the retention cleanup and the user-deletion foreign key.
- **The opt-in two-person lock.** With mandatory review switched on, a trigger on `blog_posts` refuses any change that puts a post's content or status on the public site unless it is exactly an approved staged change, through the screens or the Data API alike. Images, redirects and the other tables are outside it.
- **Staged images stay private until publish.** Uploads go to a private `blog-images-staged` bucket; the admin and the preview show them through short-lived signed links, and every way a post goes live copies its images to the public bucket first.
- **Slug swaps publish in one batch**: the unique slug is deferrable, and `publish_staged_posts()` checks it at the end of the batch.
- **StarterKit's undrawn marks are drawn.** The public renderer now draws strike, inline code, code blocks and divider lines; a test keeps the editor and the renderer on one list of nodes and marks.

### Added

- **Server autosave and an unsaved-changes warning.** A draft saves to its own row and a live post's edits to its staged copy a few seconds after you stop typing (paused while that copy is in review); leaving with unsaved changes asks first.
- **Required alt text**: asked for on insert, editable from the toolbar, a required field on the featured image, and checked again by the server before anything goes live.
- **A dark theme in the admin**: light, dark or system from the sidebar, kept in a cookie so the page never flashes.
- **Bulk actions on the posts list**: publish, unpublish or delete several posts, each one applied or skipped with its reason.
- **Search and share-card preview** for every post, with warnings for a long title or a missing description or image.
- `docs/11-hardening-and-everyday-comforts.md`, and 82 more tests than 1.2.0 (133 in all, up from 51): migration 002 on PGlite, the route handlers against stand-ins for Next.js and Supabase, and the new helpers. Each was seen failing first; then each guard was broken on purpose (29 times in the migration, 25 in the code) to confirm a test catches it.
- **Demo**: everything above that runs in a browser is live in the demo; the server-side hardening is described on the Settings page.

### Changed

- `lib/staging/rules.ts` no longer holds the origin helpers; they moved to `lib/security/request-origin.ts`.
- `APP_VERSION` reads `v1.3.0` (it had stayed at `v1.0.0`).
- SECURITY.md's known limitations: six closed, the rest restated.

## 1.2.0 (2026-10-08)

### Added

- **Staging and approval for posts** ([docs/10](docs/10-staging-and-approval.md)). Saving a published post no longer changes the live site: the edit is stored as a staged copy in a new private table, `blog_post_staged_changes` (one per post), and the public site keeps reading the live row until someone publishes. A never-published draft can be staged too.
- **Review states** `staged`, `in_review` and `approved`, enforced by a database trigger whatever client writes the row: a new stage always starts as `staged`, editing the content resets any review, an approval needs a different admin from the one who staged the content, and the bookkeeping columns cannot be written directly. Review is optional by default; `public.staging_review_required()` and `REVIEW_REQUIRED` make the staging screens and the publish function accept approved changes only. They do not lock direct writes to `blog_posts` (the editor's draft save, the posts list, the Data API); docs/10 says what a team needing two-person control must also lock.
- **`public.publish_staged_posts(uuid[])`**, which publishes a selection in one transaction (all or none) with the caller's own rights, keeps a post's first publish date (and a scheduled post's status and date), and refuses a change still waiting in review.
- **Migration `001_staging_and_approval.sql`**: the table, its RLS (admins only, the two-factor rule from 1.1.0 applied as a restrictive policy, no grant and no policy for the public key), the trigger and the publish function. Safe to run twice.
- **Admin screens**: a Staged badge on the posts list; "Stage changes" and "Publish now" on a live post in the editor, "Stage for publishing" on a draft, and the editor opening on the staged copy (where "Save staged copy" replaces Update on a draft, and "Publish now" refuses a change in review); a new **Staging** page listing every staged change with request review, approve, withdraw, discard, a live and staged comparison, and publish selected.
- **Whole-site preview through Next.js draft mode**: `POST /api/admin/preview` (same-origin form, `requireAdmin()`, on-site paths only) and `POST /api/admin/preview/exit`, plus `getPreviewPost()` and `getPreviewPosts()` for your public pages, which re-check the admin and read with the visitor's own session.
- **Audit log actions** for every staging step: `blog_post.stage`, `request_review`, `approve`, `withdraw_review`, `discard_staged`, `publish_staged` (with a `batch` count of how many published together) and `staging.preview_enabled`.
- **Database tests** in `source/supabase/tests/`: PGlite (Postgres in WebAssembly) loads both migrations with a small stand-in for Supabase's `auth` and `storage` schemas, and `node --test` checks every staging rule as each kind of caller. The staging rules the screens use (`lib/staging/rules.ts`) have their own tests. Each database test was seen failing against an empty migration before the migration was written, and the rules tests failed before their module existed; then each rule was broken on purpose, 40 times in all, to confirm a test catches every break.
- **Demo**: the Staging page, request review, approve (with a "Demo: approve as" helper, since the demo has one signed-in person), compare and publish selected are now the real behavior, with no Proposed label. Media, invite resend or cancel and the redirect tester stay labeled Proposed.

### Changed

- `lib/data.ts` exports `mapPost` so the preview reads map rows the same way the public pages do. The public data layer still never reads staged rows.
- The post status select is locked on a live post (publish or unpublish from the buttons instead) and on a draft with a staged copy, so the editor cannot change a status behind a staged change.
- The preview switch compares the browser's Origin with the site's public origin (the proxy's forwarded host, then the Host header), not `request.url`, which carries the server's bind address under `next start` behind a proxy; its redirects are relative.
- README: a staging section with a diagram, a tests section, and new screenshots; the demo's landing page and walkthrough follow the staging flow.

## 1.1.0 (2026-10-08)

### Added

- **Interactive demo** at `demo/app/` (live on GitHub Pages): sign-in with two-factor and recovery codes, posts with search, filters and sort, a TipTap rich-text editor with autosave, draft, scheduled and published states, per-post and whole-site preview, media, team, audit log with CSV export, redirects, settings, light and dark themes, and a reset button. It runs entirely in the browser under a strict Content Security Policy, with invented sample data kept in local storage. Screens that preview proposed features are labeled **Proposed**.
- `SECURITY.md`: how to report a problem, the scope, the security model in brief, and the known limitations.
- The migration now creates the `blog-images` Storage bucket (5 MB, JPEG, PNG, WebP, GIF) and four Storage RLS policies so only an active admin can write to it.
- **Two-factor in the database** (migration section 10): restrictive RLS policies so that, once a user has a verified factor, admin reads and writes on the content tables, writes on `user_roles` and anything in the `blog-images` bucket need an AAL2 session. Before this, a stolen password alone could skip the TOTP page and write through the data API, because the editor's browser-side writes never pass through `requireAdmin()`.
- `lib/admin/upload-image.ts`: one upload helper for the editor and the featured-image picker.
- Docs: security headers, a CSP plan, rate limits and Storage sections in the security checklist; Supabase's publishable and secret key names; a request-flow diagram in the README.

### Fixed

- **Turning off two-factor failed.** The password re-check signed in again on the cookie session, which replaced the user's AAL2 session with an AAL1 one, and Supabase refuses to remove a verified factor below AAL2. The check now runs on a throwaway client and leaves the session alone.
- **Browser uploads trusted the file name.** The editor and the featured-image picker took the extension from the uploaded file's name and skipped the type and size checks the server route had. Both now use the shared helper, which derives the extension from the checked type.
- **A redirect from the proxy dropped a refreshed session.** The redirect responses now carry the refreshed cookies and Supabase's cache headers.
- **A failed image upload left the button stuck on "Uploading...".** Both upload paths now recover from any error, and file names fall back to `crypto.getRandomValues()` where `randomUUID()` is missing (a plain-HTTP LAN address).
- **The image Remove button submitted its form** (testimonials). It is now `type="button"`.
- **The link allowlist let `//host` and `/\host` through** as "on-site" links. One shared `lib/safe-href.ts` is used by the editor and the public renderer.

### Changed

- The proxy checks the session with `supabase.auth.getClaims()` (Supabase's current recommendation) and passes on the cache headers `@supabase/ssr` 0.10+ provides. `requireAdmin()` still makes the authoritative `getUser()` check, and so does the proxy before it bounces a signed-in visitor away from the login page, so a session revoked on the server cannot loop between the two. The runbook pins `@supabase/ssr@^0.10`.
- `lib/supabase/server.ts` imports `server-only`, and its two cookie-less clients keep no session (`persistSession: false`).
- The editor sets `immediatelyRender: false` for the App Router, re-renders its toolbar on every transaction (TipTap 3 no longer does by default), configures Link through TipTap 3's StarterKit instead of registering it twice, and turns off StarterKit 3's Underline, which the public renderer does not draw; the link prompt refuses anything but web, mail, phone, on-site and anchor links.
- The static mockups `demo/login.html` and `demo/dashboard.html` now forward to the working demo; the README and demo screenshots show the new demo.
- Prose in the docs uses plain hyphens instead of em dashes.

## 1.0.0 (2026-06-04)

- First public release: the admin, authentication and CMS backend extracted from a production Next.js and Supabase site, the nine docs, the consolidated migration, and static mockups of the login and dashboard.
