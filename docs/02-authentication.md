# 02 — Authentication

How a user becomes (and stays) signed in. Authorization (what a signed-in user may do) is [03-authorization-and-rls.md](03-authorization-and-rls.md).

## Session model: cookies via `@supabase/ssr`

Auth state lives in HTTP cookies, set and refreshed by `@supabase/ssr`. There is no token in localStorage and no bearer header to manage. Because the session is a cookie, it works across server components, server actions, route handlers, and the proxy uniformly.

The catch with cookie sessions in the App Router is that **only the proxy (middleware) and route handlers can WRITE cookies** — server components can read them but cannot refresh them. So the proxy is responsible for refreshing the session on every request; server components just read the already-fresh cookie.

## The four client factories (`source/lib/supabase/`)

Each context needs a differently-configured Supabase client. There are exactly four:

| Factory | File | Key | Use it for |
|---|---|---|---|
| `createClient()` | `client.ts` | anon | Browser / `'use client'` components. |
| `createServerSupabaseClient()` | `server.ts` | anon | Server components + server actions. Reads the cookie session; RLS applies as the signed-in user. |
| `createServiceClient()` | `server.ts` | **service-role** | Trusted server code that must bypass RLS (reading `user_roles` past self-RLS, admin user management, audit writes). NEVER import into client code or expose to the build. |
| `createAnonServerClient()` | `server.ts` | anon | SSG / build-time fetch of PUBLIC data (e.g. published posts) without a user session. Safe in CI because the anon key is already public. |

The single most important rule in the whole kit: **the service-role key is admin-god-mode and must never reach the browser or the CI build environment.** It lives only in `SUPABASE_SERVICE_ROLE_KEY` (server env), is only imported by server-only modules, and is the reason `createServiceClient()` carries a blunt warning comment.

## The proxy gate (`source/proxy.ts` -> `source/lib/supabase/middleware.ts`)

`proxy.ts` is Next.js 16's renamed middleware. For any `/admin/*` request it calls `updateSession()`, which:

1. Builds a server client wired to read/write the request cookies.
2. Calls `supabase.auth.getUser()` (this refreshes the session if needed).
3. If the path is protected and there is no user, redirects to `/admin/login`.
4. If a signed-in user hits `/admin/login`, bounces them to `/admin/posts`.

The public auth pages (`/admin/login`, `/admin/forgot-password`, `/admin/reset-password`) are explicitly allow-listed so a signed-out user can reach them.

(`proxy.ts` also has an OPTIONAL redirect-lookup block for the Redirects resource — unrelated to auth. Delete it if you are not using redirects.)

## Public vs protected pages (the route-group split)

This trips people up, so it is worth stating plainly:

- **`source/app/admin/...`** (NOT a route group) holds the pages a signed-out user must reach: login, forgot-password, reset-password, the MFA challenge (`login/verify`), and forced enrollment (`security/enroll`). They render with no admin chrome.
- **`source/app/(admin)/...`** (a route group) holds everything that requires an active admin session. Its layout runs `requireAdmin()`.

Both produce URLs under `/admin/*`; the `(admin)` folder name is invisible in the URL. The split exists so the protected layout's gate never wraps the login page (which would be a redirect loop).

## The auth flows

### Sign in (`source/app/admin/login/page.tsx` + `LoginForm`)
Email + password via `supabase.auth.signInWithPassword`. "Remember me" sets a 30-day cookie maxAge. On success the form checks MFA state and routes to one of: the TOTP challenge (`/admin/login/verify`) if a verified factor exists, forced enrollment (`/admin/security/enroll`) if past the grace window, or the dashboard. A successful login pings `/api/admin/auth/log-success` to write an audit row (failures are recorded by Supabase's own `auth.audit_log_entries`, so the app never logs an unauthenticated "I failed" claim).

### Forgot / reset password
`forgot-password` calls `supabase.auth.resetPasswordForEmail` with a redirect to `/admin/reset-password?context=recovery`. `reset-password` handles BOTH magic-link shapes: PKCE (`?code=...`, exchanged server-side) and the legacy implicit hash (`#access_token=...`, parsed client-side and stripped from the URL). It enforces the password policy (`source/lib/auth/password-strength.ts`, 12-char minimum + letter/number/symbol) with a live checklist. The same page serves invites (`?context=invite`) — see [04-team-management.md](04-team-management.md).

### MFA (TOTP + recovery codes)
- **Enroll**: `TwoFactorEnrollmentModal` calls `/api/admin/mfa/enroll` (returns a QR + secret), then `/api/admin/mfa/verify-enroll` with the 6-digit code, which on success returns 10 single-use recovery codes (bcrypt-hashed server-side, shown once).
- **Challenge at login**: if the user has a verified factor, `requireAdmin()` sees the session is `aal1` while a factor exists (`aal2` available) and redirects to `/admin/login/verify`. `VerifyForm` calls `/api/admin/mfa/challenge` then `/api/admin/mfa/verify` with either the TOTP code or a recovery code.
- **Enforcement window**: `mustEnforceMFA()` (`source/lib/auth/mfa.ts`) computes a grace window from `FEATURE_SHIP_DATE` + `GRACE_DAYS`. During the window, unenrolled users see a soft banner (`MFAEnrollmentBanner`). After it, `requireAdmin()` hard-redirects them to `/admin/security/enroll`. Set `FEATURE_SHIP_DATE` to the date you turn enforcement on.
- **Manage**: `/admin/settings` (`TwoFactorSection`) lets a user disable 2FA (password-confirmed) or regenerate recovery codes.

The server-side MFA gate is the real enforcement. The login form's routing is a convenience; even if a client skipped it, `requireAdmin()` enforces the `aal2` + enrollment requirements on the server for every protected render.

## Why this shape

It mirrors how Linear, Stripe, and Vercel run internal-team auth: invite-only, email + password, mandatory TOTP, recovery codes, no plaintext passwords ever in email (invites send a magic link to a self-set-password page). Supabase Auth provides the primitives; this kit wires them into the App Router correctly (cookie refresh in the proxy, server-side gates, AAL enforcement).
