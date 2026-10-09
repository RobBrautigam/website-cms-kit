# 09 - Environment and Deploy

Env vars, the Supabase setup checklist, dependency classification, and host notes.

## Environment variables

| Var | Required | Scope | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | public | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | public | The public key: the legacy `anon` key or a newer publishable key (`sb_publishable_...`). Public by design (in the client bundle); RLS protects the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **server-only** | The server key: the legacy `service_role` key or a newer secret key (`sb_secret_...`). Bypasses RLS. Used by `createServiceClient`, the `/api/admin/*` routes, `requireAdmin`'s role lookup, the AI rate limit and the redirect counter. NEVER expose to the browser or the CI build. |
| `ANTHROPIC_API_KEY` | optional | server-only | Only if you use the `/api/ai/*` content-generation routes. |
| `NEXT_PUBLIC_SITE_URL` | optional | public | Absolute site URL, for building links and the search and share previews in the editor. |
| `CSP_MODE` | optional | server-only | `enforce` blocks what the Content Security Policy forbids; anything else (the default) only reports. |
| `CSP_SCOPE` | optional | server-only | `site` puts the policy on every page; the default is `/admin` only ([docs/11](11-hardening-and-everyday-comforts.md#security-headers-and-the-content-security-policy)). |
| `CSP_REPORT_URI` | optional | server-only | Where browsers send policy violation reports. |
| `HSTS_PRELOAD` | optional | server-only | `1` adds `includeSubDomains; preload` to the HSTS header. Off by default: read [HSTS and the preload list](#hsts-and-the-preload-list) first. |
| `TRUSTED_PROXY_HOPS` | optional | server-only | How many proxies in front of the app append to `X-Forwarded-For` (default `1`). The caller is read that many entries from the right, never the first entry, which the visitor writes. Set `2` behind a CDN in front of your host. |

`.env.example` lists these with placeholders. Copy to `.env.local` for dev; set them in your host's dashboard for production. Never commit real values.

**Supabase's two key generations.** Projects now show publishable and secret keys first; the JWT-based `anon` and `service_role` keys are listed as legacy. The kit reads whichever you put in the two variables above, so you can switch without a code change. Two things differ with the new keys: a secret key is refused when sent from a browser (a useful guard), and either new key can be rotated on its own without rotating the project's JWT secret. The variable names keep the old wording so existing deployments keep working.

## Supabase setup (once per project)

1. Run `source/supabase/migrations/000_admin_cms_schema.sql` in the SQL editor, then `001_staging_and_approval.sql` (staging and approval, [docs/10](10-staging-and-approval.md)), then `002_hardening.sql` ([docs/11](11-hardening-and-everyday-comforts.md)), then `003_revisions_and_scheduling.sql` ([docs/12](12-revisions-and-scheduling.md)).
2. Check the `blog-images` Storage bucket the migration created: public, 5 MB limit, MIME allow-list `image/jpeg, image/png, image/webp, image/gif`, and the four `blog_images_admin_*` policies on `storage.objects`; and the private `blog-images-staged` bucket 002 created, where images wait until their post goes live.
3. Auth -> URL Configuration -> Redirect URLs: add `/admin/reset-password` and `/admin/reset-password?context=invite` for prod + localhost.
4. Auth -> Providers -> Email: configure production SMTP; the default sender is rate-limited.
5. Auth -> Multi-Factor: enable TOTP.
6. Auth -> Password policy: set the minimum length to 12 to match the app's client-side rule.
7. Seed your first super-admin (see the runbook).
8. Enable the `pg_cron` extension (Integrations -> Cron) and re-run 003: it schedules the job that publishes scheduled posts and takes down posts at their end date ([docs/12](12-revisions-and-scheduling.md#running-the-scheduler)). The audit-log retention job is the commented block at the end of 000.
9. Auth -> Sessions: set the session lifetime and idle timeout ([below](#session-lifetime-and-idle-timeout)).

## Session lifetime and idle timeout

The kit's choice, set in the Supabase dashboard (Auth -> Sessions, and Auth -> JWT for the expiry). Read from Supabase's sessions guide on 2026-10-08:

| Setting | The kit's value | Why |
|---|---|---|
| Access token (JWT) expiry | 3600 seconds (the default) or less | The longest a signed-out or removed admin keeps working with a token already issued. |
| Time-box user sessions | 12 hours | An admin signs in again at least once a working day, two-step included. |
| Inactivity timeout | 2 hours | A laptop left open in a cafe stops being an admin session. |

Time-box and inactivity timeout are on Supabase's Pro plan and up. A session ends at the first refresh after either limit, so the real cut-off is the limit plus up to one access-token lifetime; Supabase also removes ended sessions about 24 hours later rather than at once. On the Free plan the access token expiry is the only lever; keep it at an hour, and use the team page's deactivate for a lost device.

## HSTS and the preload list

The kit sends `Strict-Transport-Security: max-age=63072000` (two years, this host only). `HSTS_PRELOAD=1` adds `includeSubDomains; preload`, which you need to submit the domain to the browsers' preload list. Only set it when every subdomain of the domain serves HTTPS (a forgotten `http://` subdomain stops working in every browser), and know that leaving the list takes months. The header is built at build time (`next.config.ts`), so redeploy after changing it.

## Type-check

The kit is a set of files to copy into your Next.js app, so it carries no `package.json` of its own. `source/typecheck/` holds a pinned one for checking the kit itself against the Next.js 16.4 types: `cd source/typecheck && npm ci && npm run typecheck` (no build, no network after the install).

## Build-time dependency classification (read this - it bites)

Hosts that set `NODE_ENV=production` at install time (Railway, Render, Heroku, App Engine, and others) run `npm install` with `--omit=dev`, which **skips `devDependencies`**. Anything used by `next build` must therefore live in `dependencies`, not `devDependencies` - including `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `autoprefixer`, `typescript`, and your `@types/*`. The default scaffolding from many tools puts these in `devDependencies`, which works locally (dev installs everything) and fails only in production. If a production build dies with "module not found" for a package that is clearly in your `package.json`, check whether it is in `devDependencies` and move it.

Verify locally before deploying:

```bash
rm -rf node_modules
NODE_ENV=production npm ci
npm run build      # if this fails on a missing module, it's misclassified
```

## Deploy

The kit is host-agnostic - any Node host that runs `next build` + `next start` works (Railway, Render, Fly, a container, etc.). The deploy is also your build gate: a broken build fails the deploy and the host keeps serving the last good version.

Generic flow:
1. Set the env vars in the host dashboard (all five, with the service-role key marked secret/server-only).
2. Connect the repo; the host builds on push.
3. After deploy, verify the live URL: sign in, confirm a protected route redirects when signed out, confirm a published row renders and a draft does not.

### A note on the proxy on non-Next-16 hosts

`source/proxy.ts` uses the Next.js 16 name (`proxy`). On Next 15 and earlier the file is `src/middleware.ts` exporting a function named `middleware` with the same body. The matcher config is identical. If you target an older Next, rename the file and the export.

### Static vs dynamic

Admin pages set `export const dynamic = 'force-dynamic'` (they must never be statically cached - they show per-request, per-role data). Public pages that read published content can stay static/ISR; the `/api/revalidate` route lets a publish action invalidate them.
