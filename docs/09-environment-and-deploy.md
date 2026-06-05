# 09 — Environment and Deploy

Env vars, the Supabase setup checklist, dependency classification, and host notes.

## Environment variables

| Var | Required | Scope | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | public | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | public | Anon key. Public by design (in the client bundle); RLS protects the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **server-only** | Bypasses RLS. Used by `createServiceClient`, the `/api/admin/*` routes, and `requireAdmin`'s role lookup. NEVER expose to the browser or the CI build. |
| `ANTHROPIC_API_KEY` | optional | server-only | Only if you use the `/api/ai/*` content-generation routes. |
| `NEXT_PUBLIC_SITE_URL` | optional | public | Absolute site URL, for building links. |

`.env.example` lists these with placeholders. Copy to `.env.local` for dev; set them in your host's dashboard for production. Never commit real values.

## Supabase setup (once per project)

1. Run `source/supabase/migrations/000_admin_cms_schema.sql` in the SQL editor.
2. Create the `blog-images` Storage bucket: public, 5 MB limit, MIME allow-list `image/jpeg, image/png, image/webp, image/gif`.
3. Auth -> URL Configuration -> Redirect URLs: add `/admin/reset-password` and `/admin/reset-password?context=invite` for prod + localhost.
4. Auth -> Providers -> Email: configure production SMTP; the default sender is rate-limited.
5. Auth -> Multi-Factor: enable TOTP.
6. Auth -> Password policy: set the minimum length to 12 to match the app's client-side rule.
7. Seed your first super-admin (see the runbook).
8. (Optional) enable the `pg_cron` extension and schedule the audit-log retention job (commented block at the end of the migration).

## Build-time dependency classification (read this — it bites)

Hosts that set `NODE_ENV=production` at install time (Railway, Render, Heroku, App Engine, and others) run `npm install` with `--omit=dev`, which **skips `devDependencies`**. Anything used by `next build` must therefore live in `dependencies`, not `devDependencies` — including `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `autoprefixer`, `typescript`, and your `@types/*`. The default scaffolding from many tools puts these in `devDependencies`, which works locally (dev installs everything) and fails only in production. If a production build dies with "module not found" for a package that is clearly in your `package.json`, check whether it is in `devDependencies` and move it.

Verify locally before deploying:

```bash
rm -rf node_modules
NODE_ENV=production npm ci
npm run build      # if this fails on a missing module, it's misclassified
```

## Deploy

The kit is host-agnostic — any Node host that runs `next build` + `next start` works (Railway, Render, Fly, a container, etc.). The deploy is also your build gate: a broken build fails the deploy and the host keeps serving the last good version.

Generic flow:
1. Set the env vars in the host dashboard (all five, with the service-role key marked secret/server-only).
2. Connect the repo; the host builds on push.
3. After deploy, verify the live URL: sign in, confirm a protected route redirects when signed out, confirm a published row renders and a draft does not.

### A note on the proxy on non-Next-16 hosts

`source/proxy.ts` uses the Next.js 16 name (`proxy`). On Next 15 and earlier the file is `src/middleware.ts` exporting a function named `middleware` with the same body. The matcher config is identical. If you target an older Next, rename the file and the export.

### Static vs dynamic

Admin pages set `export const dynamic = 'force-dynamic'` (they must never be statically cached — they show per-request, per-role data). Public pages that read published content can stay static/ISR; the `/api/revalidate` route lets a publish action invalidate them.
