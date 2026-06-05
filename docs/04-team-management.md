# 04 — Team Management

Super-admin-only user management: invite, change role, deactivate, reactivate, and password recovery. UI lives at `/admin/team` (`source/app/(admin)/admin/team/`); the mutations are JSON route handlers under `source/app/api/admin/users/`. Every endpoint is gated by `requireSuperAdmin()`.

## Invite (no plaintext password ever)

`POST /api/admin/users/invite` (`source/app/api/admin/users/invite/route.ts`):

1. Validates `{ email, name, role }` with zod (`role` is `super_admin` or `admin`).
2. Calls `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: '<origin>/admin/reset-password?context=invite', data: { name } })` with the **service-role** client. Supabase sends a magic-link email.
3. Seeds the `user_roles` row with the requested role.
4. **Rolls back on failure**: if the role insert fails, it deletes the just-created auth user so the system never ends up half-provisioned.
5. Records a `user.invite` audit row.

The invitee lands on `/admin/reset-password?context=invite` and sets their own password. No password is ever generated or emailed. This is exactly how Linear / Stripe / Vercel onboard team members, and it is why the reset-password page handles an `invite` context in addition to `recovery`.

## Change role

`PATCH /api/admin/users/[id]/role`. Guarded so the system can never lose its last super-admin: `isLastActiveSuperAdmin()` (`source/lib/auth/team-queries.ts`) blocks demoting the only remaining active super-admin (GitHub's "cannot remove last owner" rule). Records `user.role_change`.

## Deactivate / reactivate

Soft deactivation sets `user_roles.deactivated_at` (`POST .../deactivate`); reactivation clears it (`POST .../reactivate`). A deactivated user keeps their row and history but `requireAdmin()` signs them out on the next request. The last-active-super-admin guard also blocks deactivating the only super-admin. Records `user.deactivate` / `user.reactivate`.

## Recover (operator-initiated password reset)

`POST .../recover` sends a fresh recovery link to a user who is locked out, on behalf of a super-admin. Records `user.recover_password` with the actor override (the super-admin is the actor, the target user is the resource).

## Reading the team list

`fetchTeamMembers()` (`source/lib/auth/team-queries.ts`) joins `user_roles` with `auth.users` (service-role) to produce a sorted list: super-admins first, then admins, deactivated rows last. The display name comes from `auth.users.user_metadata.name` (set during invite), falling back to the email local-part for accounts created directly in the Supabase dashboard.

## The components

- `team/page.tsx` — `requireSuperAdmin()`, fetches members, renders `TeamPage`.
- `TeamPage.tsx` / `TeamMemberRow.tsx` — the list + per-row actions (role select, deactivate/reactivate, recover).
- `InviteModal.tsx` — the invite form (name, email, role), posts to the invite endpoint.

## Why these are route handlers, not server actions

Content mutations are server actions (they live next to the page that uses them). User management is a set of JSON endpoints because the operations are higher-stakes, benefit from explicit HTTP status codes (409 on "already registered", etc.), and use `auth.admin.*` calls that are clearly server-only. Both patterns coexist; pick route handlers when you want a clean request/response contract and explicit status codes, server actions when you want tight coupling to a form/table.
