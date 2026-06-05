# 01 — Architecture

The mental model for the admin CMS. Read this first; the other docs drill into each layer.

## What this is

A custom admin/CMS backend for a Next.js 16 (App Router) site backed by Supabase. It gives a small team a secure place to sign in and manage site content (blog posts, jobs, testimonials, redirects), manage each other (invite, role, deactivate), and see an audit trail. No third-party CMS, no separate backend service. The Next.js app and Postgres (via Supabase) are the whole system.

It is **invite-only**: there is no public signup. A super-admin invites people; everyone authenticates with email + password and is required to enroll in TOTP two-factor.

## The three security layers

Every protected request passes three independent gates. Each one can deny on its own, so a bug or bypass in one is backstopped by the others.

```
                         ┌─────────────────────────────────────────────┐
   Request to /admin/*   │ 1. PROXY  (source/proxy.ts)                  │
  ───────────────────────▶   refresh Supabase session cookie;          │
                         │     no session  ->  redirect /admin/login    │
                         └───────────────────────┬─────────────────────┘
                                                 │ has session cookie
                                                 ▼
                         ┌─────────────────────────────────────────────┐
                         │ 2. SERVER GATE  (requireAdmin, in each       │
                         │    (admin) layout / page / server action)    │
                         │    re-check user + role + deactivation + MFA │
                         │    not an active admin  ->  sign out + login │
                         └───────────────────────┬─────────────────────┘
                                                 │ verified active admin (AAL2)
                                                 ▼
                         ┌─────────────────────────────────────────────┐
                         │ 3. RLS  (Postgres policies, the migration)   │
                         │    even WITH a session, the DB only allows   │
                         │    admin-or-above writes + anon reads of     │
                         │    PUBLIC rows. A leaked anon key cannot     │
                         │    mutate anything.                          │
                         └─────────────────────────────────────────────┘
```

Why three and not one: the proxy is fast but coarse (it only knows "is there a session"). The server gate knows roles and MFA but trusts the app code. RLS is the last word and trusts nothing — it is enforced by Postgres regardless of what the app does. Defense in depth.

## Request lifecycle (a page load)

1. Browser requests `/admin/posts`.
2. `source/proxy.ts` runs `updateSession()` (`source/lib/supabase/middleware.ts`): it refreshes the auth cookie and, if there is no user, redirects to `/admin/login`.
3. The route group layout `source/app/(admin)/admin/layout.tsx` calls `requireAdmin()` (`source/lib/auth/require.ts`). That verifies the user, looks up their `user_roles` row with the service-role client, checks they are not deactivated, and enforces MFA (redirect to the TOTP challenge or to forced enrollment if needed). It renders `AdminShell` around the page.
4. The page server component (`source/app/(admin)/admin/posts/page.tsx`) calls `requireAdmin()` again (cheap, defense in depth) and queries `blog_posts` with the cookie-scoped server client. RLS lets an admin read all rows.
5. The page passes data to a client component (`PostsTable`) for interactivity.
6. A mutation (publish, delete) calls a **server action** (`source/app/(admin)/admin/posts/actions.ts`) which re-checks `requireAdmin()`, writes through Supabase (RLS enforced), records an audit row, and revalidates the affected paths.

## Directory map

```
source/
  proxy.ts                      Next 16 proxy: session refresh + /admin gating (+ optional redirect lookup)
  app/
    admin/                      PUBLIC auth pages (outside the protected group):
      login/ forgot-password/ reset-password/ login/verify/ security/enroll/
    (admin)/                    PROTECTED route group (everything here requires an admin session):
      layout.tsx                ThemeProvider
      admin/
        layout.tsx              requireAdmin gate + MFA banner + AdminShell
        page.tsx                redirect -> /admin/posts
        error.tsx loading.tsx   route-group error boundary + skeleton
        posts/ jobs/ testimonials/ redirects/   resource CRUD (index + new + edit + actions.ts)
        team/                   super-admin user management
        audit-log/              filterable log + CSV export
        settings/               2FA + change password
        sitemap/ help/          utility pages
    api/
      admin/auth/ admin/mfa/ admin/users/        admin-only JSON endpoints
      ai/                       optional Claude content generation
      upload/ revalidate/ redirects/hit/         image upload, ISR hook, redirect telemetry
  lib/
    supabase/                   client factories + session-refresh helper + resource data layers
    auth/                       require gates, role types, MFA, audit writer, team queries, password rules
    admin/                      ActionResult discriminated union
    redirects/                  redirect lookup + matching + validation (backs the proxy + resource)
    a11y/                       focus trap, scroll lock, media query, reduced motion
  components/
    admin/                      AdminShell, nav, primitives, MFA UI, resource UI
    TipTapRenderer.tsx          renders TipTap JSON to article HTML
    redirects/RedirectBeacon.tsx  optional internal-redirect hit telemetry
  app/globals.css               neutral design tokens + component classes (re-theme here)
  supabase/migrations/000_admin_cms_schema.sql   the whole schema + RLS
```

## Key conventions

- **Route groups split public from protected.** Auth pages live under `app/admin/` (no shell, reachable signed-out). Everything behind the gate lives under `app/(admin)/` (the `(admin)` folder name is a Next.js route group — it does not appear in the URL).
- **Server components fetch, client components interact.** Pages are server components that call `requireAdmin()` and query Supabase. Tables/forms are `'use client'` and talk back via server actions.
- **Mutations are server actions returning `ActionResult`.** A single discriminated union (`source/lib/admin/action-result.ts`) gives every mutation a uniform `{ok:true}` / `{ok:false, error, code}` shape the UI can branch on.
- **Semantic design tokens, not raw colors.** Components use classes like `bg-bg-card`, `text-text-primary`, `text-accent`. They are defined once in `source/app/globals.css`; re-theme by editing that file.

## Next steps

- Authentication details: [02-authentication.md](02-authentication.md)
- Roles + RLS: [03-authorization-and-rls.md](03-authorization-and-rls.md)
- Stand it up from scratch: [07-reproduction-runbook.md](07-reproduction-runbook.md)
