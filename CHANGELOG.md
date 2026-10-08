# Changelog

All notable changes to this kit. Dates are when the change landed on `main`.

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
