# 08 - Security Checklist

The non-negotiables. Most of these are easy to get subtly wrong and expensive to get wrong. Treat this as a pre-launch gate.

## Secrets

- [ ] **The service-role key never reaches the browser or the build.** `SUPABASE_SERVICE_ROLE_KEY` is server-only. It is imported solely by server modules (`createServiceClient` in `lib/supabase/server.ts`, the `/api/admin/*` routes, `lib/auth/*`). Never import a service-role client into a `'use client'` file. Never use it for SSG/build-time data fetching - use `createAnonServerClient()` there. A leaked service-role key is a full database compromise.
- [ ] **`server.ts` keeps its `import 'server-only'` line.** It turns an accidental client import of the service-role client into a build error.
- [ ] **Only `NEXT_PUBLIC_*` vars are public.** The anon (or publishable) key is public by design (it is in the client bundle). Nothing else is. Audit your `NEXT_PUBLIC_` vars before shipping.
- [ ] **No secrets in the repo.** `.env.local` is gitignored; commit only `.env.example` with placeholders.

## RLS

- [ ] **RLS is ENABLED on every table.** The migration does `alter table ... enable row level security` for all of them. If you add a table, enabling RLS is step one - a table with RLS off and a granted anon role is world-writable.
- [ ] **Use the `SECURITY DEFINER` helpers, not inline subqueries, in policies.** `is_admin_or_above(auth.uid())` / `is_super_admin(auth.uid())` avoid the `user_roles` recursion trap and centralize the role logic. Don't hand-roll `exists (select ... from user_roles ...)` inside a content-table policy.
- [ ] **Anon can only read PUBLIC rows.** Verify each content table's anon policy is scoped (`status = 'published'`, `is_active`, `is_visible`, `enabled`) and that there is NO anon insert/update/delete policy anywhere.
- [ ] **Staged content stays private.** `blog_post_staged_changes` has no anon grant and no anon policy, and the public data layer (`lib/data.ts`) never reads it. Only `lib/staging/preview.ts` does, behind draft mode and an admin check, with the visitor's own session. Keep it that way: never read staged rows with the anon or service-role client on a public page. The database tests (`source/supabase/tests/`) check the public key is refused.
- [ ] **Sensitive tables have no readable policy.** `admin_mfa_recovery_codes` has no RLS policy at all (service-role only). `admin_audit_log` is super-admin-read, no write policy (service-role append-only). Don't add a convenience read policy to either.

## Auth gates

- [ ] **Every protected page, layout, and mutation calls `requireAdmin()`** (or `requireSuperAdmin()`) at the top. The proxy is not enough - it only checks for a session, not role/deactivation/MFA. The server gate is the app-layer authority.
- [ ] **User-management endpoints use `requireSuperAdmin()`.** All of `/api/admin/users/*`.
- [ ] **Every API route self-gates - the proxy does NOT cover `/api/*`.** `source/proxy.ts` excludes `/api/*` from its matcher, so a route handler is NOT protected by the proxy. Each one must call `requireAdmin()` (or the right variant) at the top, BEFORE reading the body or doing any work. This includes the optional `/api/ai/*` routes: never ship an endpoint that calls a paid model (Anthropic, etc.) without an auth gate, or anyone who finds the URL can run up your bill. Place the gate OUTSIDE any `try/catch` so the redirect-throw isn't swallowed into a 500.
- [ ] **MFA-flow routes use `requirePartialAdmin()`, everything else uses `requireAdmin()`.** Mixing these up either creates an infinite redirect loop (using `requireAdmin` on the verify page) or skips the AAL gate on a sensitive page (using `requirePartialAdmin` elsewhere). Sensitive 2FA actions (disable, regenerate) MUST use `requireAdmin` so they require AAL2.
- [ ] **Two-factor holds in the database too.** Browser-side writes never pass through `requireAdmin()`, so the migration's section 10 adds restrictive policies: once a user has a verified factor, every admin read or write on the content tables, writes on `user_roles` and anything in the `blog-images` bucket need an AAL2 session. Add the same `<table>_require_mfa` policy to every admin table you add.
- [ ] **Server-side MFA enforcement is on.** Set `FEATURE_SHIP_DATE` in `lib/auth/mfa.ts` to your enforcement date. After the grace window, `requireAdmin()` hard-redirects unenrolled users to enrollment. The login form's routing is a convenience, not the enforcement.

## Mutations

- [ ] **Row ids are bound server-side, never passed as client args.** Delete/toggle actions are `action.bind(null, row.id)`. A hidden input or client-passed id can be tampered to target another row. `RowDeleteButton` enforces the no-client-arg contract.
- [ ] **Sensitive actions are audited.** Content mutations and all permission changes record an `admin_audit_log` row via `recordAdminAction()`. Add new actions to the `AuditAction` union.
- [ ] **Errors are mapped, not leaked.** `wrapSupabaseError()` turns Postgres codes into friendly messages and surfaces RLS denials (42501) as "permission denied, sign in again" rather than raw SQL error text.

## Auth configuration

- [ ] **Redirect URLs are allow-listed** in Supabase Auth (both reset-password contexts, prod + localhost). An un-allow-listed `redirectTo` silently fails the magic-link flow.
- [ ] **TOTP is enabled** in Supabase Auth.
- [ ] **Production SMTP is configured.** The default Supabase email sender is rate-limited and not for production; invites/recovery depend on email delivery.
- [ ] **Admin pages are `noindex`.** The protected layout sets `robots: noindex, nofollow`. Keep it.
- [ ] **Passwords meet the policy.** 12-char minimum + letter/number/symbol, enforced both client-side (the live checklist) and by Supabase's own password settings - set the same minimum in Supabase Auth so the server agrees with the UI.

## Storage (image uploads)

- [ ] **Uploads are authorized by Storage RLS, not by the browser.** The editor uploads straight from the browser with the user's session, so the policies on `storage.objects` decide who may write. The migration (section 9) creates the `blog-images` bucket and four policies that let only an active admin read the listing, insert, update or delete. Never "fix" a failing upload with a broad `authenticated can insert` policy: that lets every signed-in account write, deactivated ones included.
- [ ] **Size is enforced server-side; type is the declared type.** The bucket's own `file_size_limit` (5 MB) applies whatever the browser sends. Its `allowed_mime_types` (JPEG, PNG, WebP, GIF) is checked against the Content-Type the client declares, not the file's bytes; if real content checking matters to you, sniff the magic bytes in a server route and upload through it. The shared helper (`lib/admin/upload-image.ts`) checks the same rules first for a friendly error and derives the file extension from the checked MIME type, never from the file name.
- [ ] **No SVG uploads.** An SVG can carry script. It is deliberately not on the allow-list; keep it off unless you sanitize every SVG server-side.

## Security headers

Since 1.3.0 the kit ships them: `source/next.config.ts` sends a fixed set on every response (HSTS, `nosniff`, a referrer policy, `X-Frame-Options: DENY`, a permissions policy, `Cross-Origin-Opener-Policy`), and `proxy.ts` adds a Content Security Policy with a fresh nonce on every request, report-only on the admin by default. The full list, the policy and its three switches are in [docs/11](11-hardening-and-everyday-comforts.md#security-headers-and-the-content-security-policy).

- [ ] **Merge `next.config.ts` into yours** if your app already has one, so the headers actually ship.
- [ ] **Watch the CSP reports, then enforce.** Set `CSP_REPORT_URI` to collect them; once the admin reports nothing unexpected, set `CSP_MODE=enforce`. `CSP_SCOPE=site` extends the policy to the public pages (read docs/11 first: statically rendered pages carry no nonce). The interactive demo in `demo/app/` runs under a strict enforced CSP (no inline script, no inline style).
- [ ] **Only send HSTS once HTTPS works everywhere on the domain**, subdomains included, or drop `includeSubDomains` and `preload` in `lib/security/headers.ts`.

## Rate limits

- [ ] **Keep Supabase Auth's built-in limits on** (Dashboard -> Authentication -> Rate Limits): sign-in attempts, token refreshes, TOTP verification and emails sent. They are the brute-force protection for the login and two-factor screens.
- [ ] **Run migration 002 for the app's own limits.** The `/api/ai/*` routes share a budget per admin (20 calls in 10 minutes by default) and refuse when the limiter is down; the redirect counter is counted by the server only, per visitor and per redirect, and the public key can no longer bump it. Both live in the database ([docs/11](11-hardening-and-everyday-comforts.md#per-caller-limits)). Treat redirect counts as analytics, never as security data, and make sure the address header your host sets is the one `clientAddress()` reads.
- [ ] **Know what covers the recovery-code screen.** Recovery codes are checked by the app, not by Supabase Auth, so Auth's TOTP limit does not apply to them. They hold up anyway: each is 12 characters from a 32-letter alphabet (60 bits), bcrypt-hashed and single-use, and the screen is only reachable with a correct password. A per-user attempt limit on `/api/admin/mfa/verify` is still a cheap extra.

## Before you go live

- [ ] Confirm a signed-out request to a protected route redirects to login.
- [ ] Confirm a deactivated user is signed out on their next request.
- [ ] Confirm a leaked-anon-key write attempt fails (try `supabase.from('blog_posts').insert(...)` from the browser console while signed out - it must be rejected by RLS).
- [ ] Confirm you cannot demote/deactivate the last super-admin.
- [ ] Confirm a signed-out browser cannot read a staged change (`supabase.from('blog_post_staged_changes').select()` with the public key must fail), that your public blog pages show the live post while a staged copy exists, and that `npm test` in `source/supabase/tests` passes.
- [ ] Confirm the preview switch refuses a request from another site: a form on another origin posting to `/api/admin/preview` must get a 403, and copying the draft-mode cookie into a signed-out browser must show the live site. Every other state-changing admin route answers a cross-site request the same way (1.3.0).
- [ ] Confirm the headers ship: `curl -sI https://your-domain/admin/login` shows `strict-transport-security`, `x-frame-options` and a `content-security-policy-report-only` (or, once enforced, `content-security-policy`) header.
- [ ] Confirm an image uploaded to a draft is not reachable at its public address until the post is published, and is afterwards.
- [ ] Confirm the service-role key is absent from the client bundle (search the built JS for the key's first characters - it must not appear).
