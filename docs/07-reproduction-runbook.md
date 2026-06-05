# 07 — Reproduction Runbook

Stand up the admin CMS on a fresh Next.js 16 + Supabase project, in order. Each step is concrete. An "adapting to an existing app" addendum is at the end.

## Prerequisites

- A Next.js 16 App Router app (TypeScript, Tailwind v4). `npx create-next-app@latest` is fine.
- A Supabase project (free tier works). Have the project URL, anon key, and service-role key handy (Project Settings -> API).
- Node 22+.

## 1. Install dependencies

```bash
npm i @supabase/ssr @supabase/supabase-js zod react-hook-form @hookform/resolvers sonner lucide-react bcryptjs
# Rich-text editor (posts resource):
npm i @tiptap/react @tiptap/starter-kit @tiptap/extension-image @tiptap/extension-link @tiptap/extension-placeholder @tiptap/pm
# Help page renderer (optional):
npm i react-markdown remark-gfm
# AI generation route (optional):
npm i @anthropic-ai/sdk
```

All of these belong in `dependencies`, not `devDependencies` — hosts that set `NODE_ENV=production` at install time skip devDeps and your build will fail. (See [09-environment-and-deploy.md](09-environment-and-deploy.md).)

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY     # server-only; never expose to the browser/build
# Optional:
ANTHROPIC_API_KEY=YOUR_KEY                          # only if using /api/ai/*
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

## 3. Run the schema migration

Open Supabase -> SQL Editor, paste the entire contents of `source/supabase/migrations/000_admin_cms_schema.sql`, and run it. This creates `user_roles`, the `SECURITY DEFINER` role helpers, all content tables with hardened RLS, the audit log, and the MFA recovery-code store.

## 4. Create the Storage bucket

Supabase -> Storage -> New bucket:
- Name: `blog-images`
- Public: ON
- File size limit: 5 MB
- Allowed MIME types: `image/jpeg, image/png, image/webp, image/gif`

## 5. Configure Supabase Auth

Supabase -> Authentication:
- **URL Configuration -> Redirect URLs**: add
  - `https://YOUR_DOMAIN/admin/reset-password`
  - `https://YOUR_DOMAIN/admin/reset-password?context=invite`
  - (and the `http://localhost:3000` equivalents for local dev)
- **Providers -> Email**: ensure email sending works (invite + recovery depend on it). For production, configure custom SMTP.
- **Multi-Factor Auth**: enable TOTP.

## 6. Copy the source files

Copy `source/` into your app, preserving the tree, mapped onto `src/`:

| Kit path | Your app path |
|---|---|
| `source/proxy.ts` | `src/proxy.ts` (Next 16 proxy; on older Next, `src/middleware.ts` exporting `middleware`) |
| `source/app/admin/**` | `src/app/admin/**` |
| `source/app/(admin)/**` | `src/app/(admin)/**` |
| `source/app/api/**` | `src/app/api/**` |
| `source/lib/**` | `src/lib/**` |
| `source/components/**` | `src/components/**` |
| `source/app/globals.css` | merge into your root CSS (or import it) |

Set the `@/*` path alias in `tsconfig.json`:

```json
{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
```

Import `globals.css` (with `@import "tailwindcss";` at the top) from your root layout so Tailwind + the design tokens load.

## 7. Seed your first super-admin

Create the auth user (Authentication -> Add user, set a password), then in the SQL editor (replace the email):

```sql
insert into public.user_roles (user_id, role)
select id, 'super_admin' from auth.users where email = 'admin@example.com'
on conflict (user_id) do update set role = 'super_admin', deactivated_at = null;
```

## 8. Verify

```bash
npm run dev
```

- Visit `/admin/login`, sign in as your super-admin.
- You will be prompted to enroll in TOTP (scan the QR with an authenticator). Save the recovery codes.
- Create a post at `/admin/posts/new`, set it Published, save. Confirm it is in the list.
- Confirm a published post is readable by the anon key (your public `/blog` page, if you have one) and a draft is not.
- Sign out, confirm `/admin/posts` redirects to `/admin/login`.
- (Super-admin) invite a second user at `/admin/team` and confirm the invite email arrives.

If all of that works, the admin CMS is live.

## Addendum: adapting to an existing app

- **Existing proxy/middleware**: merge the `/admin` gating into your current proxy rather than replacing it. The auth concern is the `updateSession()` call; keep your other proxy responsibilities.
- **Existing `user_roles` / auth**: if you already have users, just add the role helpers + the `user_roles` columns (`deactivated_at`, the role CHECK) and backfill roles. Don't drop your existing auth.
- **Route collisions**: if `/admin` is taken, namespace the kit (e.g. `/console`) by renaming the `app/admin` and `app/(admin)/admin` folders and updating the proxy matcher + the redirect targets in `lib/supabase/middleware.ts` and `lib/auth/require.ts`.
- **Design tokens**: if you already have a token layer, map the kit's semantic names (`bg-bg-card`, `text-text-primary`, `text-accent`, `border-border`, `btn-primary`) onto your tokens instead of importing the kit's `globals.css` wholesale.
- **Drop what you don't need**: the redirects resource (+ its proxy block + the beacon), the AI routes, and individual content resources are all independent. Delete any you don't want.
