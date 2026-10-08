# Changelog

All notable changes to this kit. Dates are when the change landed on `main`.

## 1.2.0 (2026-10-08)

### Added

- **Staging and approval for posts** ([docs/10](docs/10-staging-and-approval.md)). Saving a published post no longer changes the live site: the edit is stored as a staged copy in a new private table, `blog_post_staged_changes` (one per post), and the public site keeps reading the live row until someone publishes. A never-published draft can be staged too.
- **Review states** `staged`, `in_review` and `approved`, enforced by a database trigger whatever client writes the row: a new stage always starts as `staged`, editing the content resets any review, an approval needs a different admin from the one who staged the content, and the bookkeeping columns cannot be written directly. Review is optional by default; `public.staging_review_required()` and `REVIEW_REQUIRED` make it mandatory.
- **`public.publish_staged_posts(uuid[])`**, which publishes a selection in one transaction (all or none) with the caller's own rights, keeps a post's first publish date, and refuses a change still waiting for an approval.
- **Migration `001_staging_and_approval.sql`**: the table, its RLS (admins only, the two-factor rule from 1.1.0 applied as a restrictive policy, no grant and no policy for the public key), the trigger and the publish function. Safe to run twice.
- **Admin screens**: a Staged badge on the posts list; "Stage changes" and "Publish now" on a live post in the editor, "Stage for publishing" on a draft, and the editor opening on the staged copy; a new **Staging** page listing every staged change with request review, approve, withdraw, discard, a live and staged comparison, and publish selected.
- **Whole-site preview through Next.js draft mode**: `POST /api/admin/preview` (same-origin form, `requireAdmin()`, on-site paths only) and `POST /api/admin/preview/exit`, plus `getPreviewPost()` and `getPreviewPosts()` for your public pages, which re-check the admin and read with the visitor's own session.
- **Audit log actions** for every staging step: `blog_post.stage`, `request_review`, `approve`, `withdraw_review`, `discard_staged`, `publish_staged` (with a batch id when several publish together) and `staging.preview_enabled`.
- **Database tests** in `source/supabase/tests/`: PGlite (Postgres in WebAssembly) loads both migrations with a small stand-in for Supabase's `auth` and `storage` schemas, and `node --test` checks every staging rule as each kind of caller. The staging rules the screens use (`lib/staging/rules.ts`) have their own tests. Every test was seen failing before the code it guards existed, and each rule was then broken on purpose to confirm a test catches it.
- **Demo**: the Staging page, request review, approve (with a "Demo: approve as" helper, since the demo has one signed-in person), compare and publish selected are now the real behavior, with no Proposed label. Media, invite resend or cancel and the redirect tester stay labeled Proposed.

### Changed

- `lib/data.ts` exports `mapPost` so the preview reads map rows the same way the public pages do. The public data layer still never reads staged rows.
- The post status select is locked on a live post (publish or unpublish from the buttons instead), so a status change cannot slip past staging.
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
