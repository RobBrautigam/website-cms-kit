# 08 — Security Checklist

The non-negotiables. Most of these are easy to get subtly wrong and expensive to get wrong. Treat this as a pre-launch gate.

## Secrets

- [ ] **The service-role key never reaches the browser or the build.** `SUPABASE_SERVICE_ROLE_KEY` is server-only. It is imported solely by server modules (`createServiceClient` in `lib/supabase/server.ts`, the `/api/admin/*` routes, `lib/auth/*`). Never import a service-role client into a `'use client'` file. Never use it for SSG/build-time data fetching — use `createAnonServerClient()` there. A leaked service-role key is a full database compromise.
- [ ] **Only `NEXT_PUBLIC_*` vars are public.** The anon key is public by design (it is in the client bundle). Nothing else is. Audit your `NEXT_PUBLIC_` vars before shipping.
- [ ] **No secrets in the repo.** `.env.local` is gitignored; commit only `.env.example` with placeholders.

## RLS

- [ ] **RLS is ENABLED on every table.** The migration does `alter table ... enable row level security` for all of them. If you add a table, enabling RLS is step one — a table with RLS off and a granted anon role is world-writable.
- [ ] **Use the `SECURITY DEFINER` helpers, not inline subqueries, in policies.** `is_admin_or_above(auth.uid())` / `is_super_admin(auth.uid())` avoid the `user_roles` recursion trap and centralize the role logic. Don't hand-roll `exists (select ... from user_roles ...)` inside a content-table policy.
- [ ] **Anon can only read PUBLIC rows.** Verify each content table's anon policy is scoped (`status = 'published'`, `is_active`, `is_visible`, `enabled`) and that there is NO anon insert/update/delete policy anywhere.
- [ ] **Sensitive tables have no readable policy.** `admin_mfa_recovery_codes` has no RLS policy at all (service-role only). `admin_audit_log` is super-admin-read, no write policy (service-role append-only). Don't add a convenience read policy to either.

## Auth gates

- [ ] **Every protected page, layout, and mutation calls `requireAdmin()`** (or `requireSuperAdmin()`) at the top. The proxy is not enough — it only checks for a session, not role/deactivation/MFA. The server gate is the app-layer authority.
- [ ] **User-management endpoints use `requireSuperAdmin()`.** All of `/api/admin/users/*`.
- [ ] **Every API route self-gates — the proxy does NOT cover `/api/*`.** `source/proxy.ts` excludes `/api/*` from its matcher, so a route handler is NOT protected by the proxy. Each one must call `requireAdmin()` (or the right variant) at the top, BEFORE reading the body or doing any work. This includes the optional `/api/ai/*` routes: never ship an endpoint that calls a paid model (Anthropic, etc.) without an auth gate, or anyone who finds the URL can run up your bill. Place the gate OUTSIDE any `try/catch` so the redirect-throw isn't swallowed into a 500.
- [ ] **MFA-flow routes use `requirePartialAdmin()`, everything else uses `requireAdmin()`.** Mixing these up either creates an infinite redirect loop (using `requireAdmin` on the verify page) or skips the AAL gate on a sensitive page (using `requirePartialAdmin` elsewhere). Sensitive 2FA actions (disable, regenerate) MUST use `requireAdmin` so they require AAL2.
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
- [ ] **Passwords meet the policy.** 12-char minimum + letter/number/symbol, enforced both client-side (the live checklist) and by Supabase's own password settings — set the same minimum in Supabase Auth so the server agrees with the UI.

## Before you go live

- [ ] Confirm a signed-out request to a protected route redirects to login.
- [ ] Confirm a deactivated user is signed out on their next request.
- [ ] Confirm a leaked-anon-key write attempt fails (try `supabase.from('blog_posts').insert(...)` from the browser console while signed out — it must be rejected by RLS).
- [ ] Confirm you cannot demote/deactivate the last super-admin.
- [ ] Confirm the service-role key is absent from the client bundle (search the built JS for the key's first characters — it must not appear).
