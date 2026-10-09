# 11 - Hardening and everyday comforts (1.3.0)

What 1.3.0 added: migration `002_hardening.sql`, security headers and a Content Security Policy, one same-site check on every state-changing route, per-caller limits, schemas on the AI routes' output, private staged images, and five comforts in the editor and the posts list. Each item names the file that does it and the test that guards it; every test was seen failing before the code it guards was written or wired, and each guard was then broken on purpose to confirm a test catches it.

## Run order

1. `000_admin_cms_schema.sql`
2. `001_staging_and_approval.sql`
3. `002_hardening.sql`

All three are idempotent. 002 replaces `publish_staged_posts()` from 001 and tightens two things 000 sets up (who may call `increment_redirect_hit()`, and the two-factor rule on image uploads), so if you ever re-run 000 or 001, run 002 again after it. The database tests load all three (`npm test` in `source/supabase/tests`).

## Security headers and the Content Security Policy

`source/next.config.ts` sends a fixed set on every response (`lib/security/headers.ts`, `SECURITY_HEADERS`):

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), browsing-topics=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |

It also turns off the `X-Powered-By` header. Merge it into your own `next.config.ts` if you have one. Only send HSTS once HTTPS works everywhere on the domain, subdomains included, or drop `includeSubDomains` and `preload`.

**The Content Security Policy** carries a fresh nonce on every request, so `proxy.ts` sets it (`lib/security/csp.ts`), not the config. Next.js reads the nonce from the policy header on the request and stamps it on its own scripts; a server component of yours can read it from `headers().get('x-nonce')`. Checked on 2026-10-08 against Next.js 16's request-header parsing, which accepts the nonce from `Content-Security-Policy` or `Content-Security-Policy-Report-Only`.

| Variable | Default | Effect |
|---|---|---|
| `CSP_MODE` | report only | `enforce` blocks instead of reporting |
| `CSP_SCOPE` | `/admin` only | `site` covers every page |
| `CSP_REPORT_URI` | none | where browsers send violation reports |

The policy: `default-src 'self'`; scripts from this site plus the nonce, with `'strict-dynamic'` (and `'unsafe-eval'` in development only); styles from this site plus inline (Tailwind, TipTap and `next/font` inline small style blocks); images, the API and Realtime from your Supabase project; no plugins; forms and `<base>` to this site only. `frame-ancestors 'none'` and `upgrade-insecure-requests` are added only when enforced, because browsers ignore them in a report-only policy.

Why the admin only by default: the admin always renders dynamically, so every script there carries the nonce and the reports are exact. Statically rendered public pages carry no nonce, so with `CSP_SCOPE=site` they report Next.js's own inline scripts until those pages render dynamically. Start report-only, watch the reports for a week, then set `CSP_MODE=enforce`.

Tests: `lib/security/headers.test.mjs` (the header set, the policy for each mode, the nonce, the scope).

## One same-site check on every state-changing route

`lib/security/request-origin.ts`, `crossSiteRefusal(request)`. Every route handler that changes something with the admin's cookie calls it first, before the auth check: the 17 older routes (two-factor, user management, uploads, the AI routes, revalidation) and the two preview routes. A request must show it came from a page on this site through the browser-set `Origin` header, or `Sec-Fetch-Site: same-origin` when the origin is opaque; anything else gets a 403 and learns nothing about the session. The site's origin comes from the proxy's `X-Forwarded-Host`, then the `Host` header, so `next start` behind a proxy works.

The session cookie is already `SameSite=Lax`; this is the second lock, and the one that holds for a sibling subdomain (which counts as same-site). Server Actions get the same check from Next.js itself.

Tests: `lib/security/request-origin.test.mjs`, including a scan of every route file that fails if a state-changing handler reaches `requireAdmin()` (or draft mode) before the check. The redirect beacon (`/api/redirects/hit/[id]`) is the one public exception: it is called from the public site, carries no session, and is limited instead.

## Per-caller limits

Kept in the database (`api_rate_limits` and `consume_rate_limit()`, migration section 15), so they survive a restart and hold across several servers. One atomic upsert per call; no extra service.

- **The AI routes** share one budget per admin: 20 calls in 10 minutes by default (`RATE_LIMITS.ai` in `lib/security/rate-limit.ts`). Over it, a 429 with `Retry-After`. If the limiter itself fails, the routes answer 503 rather than spend without a limit.
- **The redirect counter.** The public key can no longer bump a count: `increment_redirect_hit` is revoked from `anon` and `authenticated`. The server counts a hit through `record_redirect_hit()` with the service role key, per visitor (5 an hour for one redirect) and with a ceiling per redirect (2,000 an hour), so neither one visitor nor a rotation of made-up addresses can inflate a count. The visitor's address is read from the header your host sets (`clientAddress()`); behind anything but your own edge, that header is only as trustworthy as the edge.
- Only the server (the service role) can read or spend the table. Clear old windows now and then, by hand or with `pg_cron`: `delete from public.api_rate_limits where window_started_at < now() - interval '1 day';`

Tests: `rate-limit.test.mjs`, `hardening.test.mjs` (the limiter's windows, the revoked grants), `routes.test.mjs` (429, 503, the shared budget, the beacon on the service role keyed by the visitor).

## Schemas on the AI routes' output

`lib/ai/schemas.ts` (zod). Each AI route validates its input, then parses the model's reply against a schema before anything reaches the editor: title suggestions, a meta description, or a whole post whose body may use only the nodes and marks the site draws (`lib/tiptap/schema.ts`), with links limited to web, mail, phone, site-path and anchor addresses and images to https or a site path, so a prompt-injected `javascript:` link never reaches the editor. A reply that does not fit is a 502 with a plain message, never handed to the editor. Error messages no longer echo internal details.

Tests: `schemas.test.mjs` and the AI cases in `routes.test.mjs`.

## The password before new recovery codes

`/api/admin/mfa/regenerate-codes` now needs the account password, checked on a throwaway client so the session stays at AAL2 (`lib/auth/reauth.ts`, shared with turning two-factor off). No password is a 400, a wrong one a 401, and in both cases the old codes stay. The settings dialog asks for it.

Tests: `routes.test.mjs` (400, 401, 200, and the codes unchanged on a refusal).

## The audit log is append-only by trigger

Migration section 14. Triggers refuse every `UPDATE`, `DELETE` and `TRUNCATE` on `admin_audit_log` whoever runs it, the service role included, with two exceptions: deleting rows older than the retention window (24 months, `admin_audit_log_retention()`), so the retention job keeps working; and clearing `actor_user_id` when that user is deleted (the foreign key's `ON DELETE SET NULL`). The table owner can still disable a trigger; ship rows to external storage if you need evidence that survives the database owner.

Tests: `hardening.test.mjs`.

## The opt-in two-person lock

Migration section 17, `blog_posts_two_person_lock()`, behind the same switch as mandatory review (`public.staging_review_required()`, off by default). With it on, a signed-in admin, through the cookie session or the Data API alike, can no longer change a post's content or status on the public site except by publishing a change a second admin approved:

- a new post starts as a draft;
- a draft's content can be edited freely (it is not on the site);
- a live or scheduled post can be taken down (back to draft) or deleted;
- any other change to a live or scheduled post, and any change that makes a post live or scheduled, must carry exactly the content of an approved staged change for that post. `publish_staged_posts()` is the normal way.

The lock covers `blog_posts` only. Image files, `url_redirects`, testimonials, jobs and the other tables stay under ordinary admin rights, so an admin can still replace an image's bytes or point a redirect elsewhere alone; a team that needs those under two-person control must lock them too. The service role and the table owner are not affected (server jobs, migrations). Set `REVIEW_REQUIRED` in `lib/staging/rules.ts` to match, so the screens send every go-live through staging.

Tests: `hardening.test.mjs` (each path as an admin, the switch off and on).

## Slug swaps publish in one batch

Migration section 16. The unique slug is now `deferrable initially immediate`: every ordinary write is checked at once, as before, and `publish_staged_posts()` defers the check to the end of the batch, so two staged changes that swap slugs publish together. A real duplicate still fails the whole batch.

Tests: `hardening.test.mjs`.

## Staged images stay private until publish

Migration section 18 and `lib/staging/`. The editor uploads to a private bucket, `blog-images-staged` (same 5 MB limit and types, admin-only policies, the two-factor rule). The post stores the image's final public address from the start, so nothing in the content changes at publish:

- the admin shows a not-yet-public image through `/api/admin/staged-image`, which re-checks the admin and redirects to a five-minute signed link;
- the whole-site preview signs staged images for ten minutes;
- every way a post goes live (Publish now, the Staging page, the posts list, a direct save as published or scheduled, bulk publish) first copies its staged images to the public `blog-images` bucket and removes the staged copies (`promoteImages()`); a copy that fails stops the publish with a message.

Two known gaps: a staged image whose post is never published stays in the private bucket (clean it up on a schedule), and images promoted for a publish that then fails stay public.

Tests: `images.test.mjs`, the promotion cases in `routes.test.mjs`, and the bucket policies in `hardening.test.mjs`.

## The editor draws only what the site draws

StarterKit enables marks and nodes the public renderer did not draw. 1.3.0 draws them all (`components/TipTapRenderer.tsx`: strike, inline code, code block, divider line) and adds their toolbar buttons; underline stays off. `lib/tiptap/schema.ts` lists every node and mark the site draws, and a test scans the renderer and the editor so the two cannot drift again.

## Everyday comforts

- **Unsaved changes and server autosave** (`components/admin/PostForm.tsx`, `lib/admin/autosave.ts`). A few seconds after you stop typing, a draft saves to its own row, and a live post (or any post with a staged copy) saves to its staged copy (paused while that copy is in review or approved, so autosave never resets a review). A scheduled post is never autosaved, since it goes live on its own at its date: its edits wait for Update. A new post saves in the browser until its first save. The status line says which, and leaving with unsaved changes asks first.
- **Required alt text** (`lib/admin/alt-text.ts`). Inserting an image asks for alt text, an Alt text button edits it, and the featured image has a required field. Drafts save without it; publishing, scheduling and staging do not, and the server actions run the same check.
- **Dark theme in the admin** (`components/ThemeProvider.tsx`, `lib/admin/theme.ts`). Light, dark or system, from the sidebar; the choice is kept in a cookie so the server renders the right theme and the page never flashes.
- **Bulk actions on the posts list** (`components/admin/PostsTable.tsx`, `lib/admin/bulk.ts`). Pick posts, then publish, unpublish or delete them. Each post is applied or skipped with its reason (already live, images without alt text, a staged change waiting, review required), and the server re-reads and re-plans rather than trusting the browser's list. Up to 100 at a time.
- **Search and social preview per post** (`components/admin/PostMetaSidebar.tsx`, `lib/admin/previews.ts`). How the post looks in a search result and in a share card, with warnings for a long title, a missing description or a missing image. The domain comes from `NEXT_PUBLIC_SITE_URL`.

Tests: `lib/admin/comforts.test.mjs`.

## Files

| File | What it does |
|---|---|
| `source/supabase/migrations/002_hardening.sql` | Sections 14 to 18 above |
| `source/next.config.ts`, `lib/security/headers.ts`, `lib/security/csp.ts`, `proxy.ts` | Headers and the policy |
| `lib/security/request-origin.ts` | The same-site check |
| `lib/security/rate-limit.ts`, `rate-limit-db.ts` | The limits |
| `lib/ai/schemas.ts`, `lib/tiptap/schema.ts` | The AI schemas and the drawn node list |
| `lib/auth/reauth.ts` | The password re-check |
| `lib/staging/images.ts`, `promote-images.ts`, `app/api/admin/staged-image/route.ts` | Private staged images |
| `lib/admin/*.ts` | The comforts' rules |
| `source/supabase/tests/` | `hardening`, `routes` and the `lib/**` tests |
