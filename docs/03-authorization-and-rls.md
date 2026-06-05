# 03 — Authorization and RLS

Who may do what, and how Postgres enforces it independently of the app. Authentication (becoming signed in) is [02-authentication.md](02-authentication.md).

## The role model

One table, `user_roles`, with one row per admin user:

| Role | Capability |
|---|---|
| `super_admin` | Everything, plus user management (invite, change roles, deactivate) and the audit log. |
| `admin` | Manage all content (posts, jobs, testimonials, redirects). No user management. |
| `editor` | Reserved in the CHECK constraint as a future third tier. **Granted nothing today** and not surfaced in the UI. |

A `deactivated_at` timestamp soft-disables an account: the row stays for history but the user loses all access.

## Server gates (`source/lib/auth/require.ts`)

Four functions gate server code. Use the strictest one that fits:

| Function | Guarantees | Use in |
|---|---|---|
| `requireAdmin()` | Active admin (or super) + **MFA satisfied (AAL2)**. Redirects otherwise. | Every protected page, layout, and content mutation. |
| `requireSuperAdmin()` | All of the above + role is `super_admin`. | Team management pages + `/api/admin/users/*`. |
| `requirePartialAdmin()` | Active admin, but does NOT enforce the AAL/enrollment gate. | ONLY the MFA-flow routes themselves (`login/verify`, `security/enroll`, `/api/admin/mfa/*`) — using `requireAdmin` there would infinite-loop. |
| `getAdminRoleOrNull()` | Returns the role without redirecting. | Read-only role checks; use sparingly (prefer the role passed down from the layout). |

`requireAdmin()` reads the user's role with the **service-role client** so it works regardless of the `user_roles` self-RLS shape, checks `deactivated_at`, then enforces MFA: if a verified factor exists but the session is still `aal1`, redirect to the TOTP challenge; if no factor exists and the grace window has elapsed, redirect to forced enrollment.

The gates are defense in depth on top of the proxy. The proxy only knows "is there a session"; the gates know roles, deactivation, and MFA. Call `requireAdmin()` (or the stricter variant) at the TOP of every protected page and every server action — it is cheap and it is the line that actually enforces authorization in the app layer.

## RLS: the database enforces it too

The app gates are necessary but not sufficient — they trust the app code. Row-Level Security in Postgres is the final authority and trusts nothing. Even with a valid session and a tampered client, the database only permits what its policies allow.

### The recursion trap and the fix

The obvious `user_roles` policy ("a row is writable if the caller is an admin") needs to read `user_roles` to check the caller's role — which re-triggers the policy, which reads `user_roles`, forever. Postgres rejects this as infinite recursion.

The fix (the canonical Supabase pattern) is two `SECURITY DEFINER` helper functions that read `user_roles` **without** triggering RLS, because they run as the function owner:

```sql
create function public.is_admin_or_above(uid uuid) returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role in ('super_admin','admin') and deactivated_at is null
  );
$$;
-- (is_super_admin is the same, restricted to role = 'super_admin')
```

These are locked down (`revoke all ... from public; grant execute ... to authenticated, service_role`) so they can only be called from within policies and trusted server code. See `source/supabase/migrations/000_admin_cms_schema.sql`.

### The standard per-table policy set

Every content table (`blog_posts`, `job_openings`, `testimonials`, `url_redirects`) gets the same five policies:

1. **anon read of public rows only** — `to anon using (status = 'published')` / `is_active` / `is_visible` / `enabled`. This is what lets the public site render published content with the anon key.
2. **admin read all** — `to authenticated using (is_admin_or_above(auth.uid()))`. Admins see drafts too.
3. **admin insert** — `with check (is_admin_or_above(auth.uid()))`.
4. **admin update** — `using (...) with check (...)`.
5. **admin delete** — `using (...)`.

So: the public sees only published rows; admins see and mutate everything; a leaked anon key can read published content (already public) but cannot write a single row.

`user_roles` itself: a user may read their own row OR (if super-admin) all rows; only super-admins may write. `admin_audit_log`: super-admins may read; nobody may write through RLS (writes go through the service-role client only — append-only by construction). `admin_mfa_recovery_codes`: NO policies at all, so even the owner cannot read their own hashes except through the service-role helper.

## The audit log (`source/lib/auth/audit.ts`)

Every sensitive mutation records a row in `admin_audit_log` via `recordAdminAction()`. It captures the actor (user id + email + role), the action (a typed union like `blog_post.publish`, `user.role_change`), the resource, a JSON payload, plus IP and user-agent. It is best-effort (a failed audit insert logs but never breaks the mutation) and uses the service-role client. The `/admin/audit-log` page (super-admin only) renders and filters it and exports CSV.

To add a new audited action: add the literal to the `AuditAction` union in `source/lib/auth/audit.ts` AND to the action filter on the audit-log view. The union is the single source of truth for what is auditable.

## Putting it together

A "delete post" click: the client calls the `deletePost` server action -> `requireAdmin()` (app gate: active admin + AAL2) -> `supabase.from('blog_posts').delete()` (RLS gate: `is_admin_or_above` must be true) -> `recordAdminAction({action:'blog_post.delete', ...})` -> `revalidatePath`. Three independent checks, one audit row, uniform `ActionResult` back to the UI.
