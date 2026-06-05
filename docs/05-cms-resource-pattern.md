# 05 — The CMS Resource Pattern

Every content type in this kit (posts, jobs, testimonials, redirects) follows the same shape. Learn it once and adding your own resource is mechanical. This doc is the "add your own resource" guide.

## The shape

A resource is a folder under `source/app/(admin)/admin/<resource>/` with:

```
<resource>/
  page.tsx            index: requireAdmin(), query rows, render a table/list
  actions.ts          'use server' mutations returning ActionResult
  <Resource>Form.tsx  'use client' create/edit form (shared by new + edit)
  new/page.tsx        renders the form empty
  [id]/edit/page.tsx  fetches one row, renders the form pre-filled
```

Backed by:
- a table in `source/supabase/migrations/000_admin_cms_schema.sql` with the standard RLS policy set (anon read of public rows, admin-or-above writes),
- a nav entry in `source/components/admin/AdminSidebar.tsx`,
- optionally a data-access helper in `source/lib/supabase/<resource>.ts` and an `AuditAction` literal in `source/lib/auth/audit.ts`.

`posts` is the richest worked example (rich-text editor, autosave, AI generate, duplicate, status toggle). `jobs` and `redirects` are simpler and show the same skeleton without the editor. Read `posts` to see the ceiling and `redirects` to see the floor.

## The index page (server component)

```tsx
// app/(admin)/admin/<resource>/page.tsx
import { requireAdmin } from '@/lib/auth/require'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'   // admin lists are never statically cached

export default async function Page() {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from('<table>').select('...').order('updated_at', { ascending: false })
  return <ResourceTable rows={data ?? []} />   // hand off to a client component
}
```

## Server actions (the mutations)

```ts
// app/(admin)/admin/<resource>/actions.ts
'use server'
import { requireAdmin } from '@/lib/auth/require'
import { recordAdminAction } from '@/lib/auth/audit'
import { ok, err, wrapSupabaseError, type ActionResult } from '@/lib/admin/action-result'
import { revalidatePath } from 'next/cache'

export async function deleteThing(id: string): Promise<ActionResult> {
  await requireAdmin()                                  // 1. re-gate on the server
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('<table>').delete().eq('id', id).select('id').maybeSingle()
  const wrapped = wrapSupabaseError(error); if (wrapped) return wrapped   // 2. uniform error mapping
  if (!data) return err('Not found.', 'not_found')
  await recordAdminAction({ action: '<thing>.delete', resource_type: '<thing>', resource_id: id })  // 3. audit
  revalidatePath('/admin/<resource>')                  // 4. refresh the list
  return ok()
}
```

Three rules that matter:

- **Bind ids server-side, never trust the client.** A row delete button receives `deleteThing.bind(null, row.id)` — the id is captured on the server, so a tampered client cannot retarget the deletion. `RowDeleteButton` is built to take a pre-bound action with no client args for exactly this reason.
- **Return `ActionResult`, don't throw.** `wrapSupabaseError()` maps Postgres error codes to friendly messages (23505 -> "already exists", 42501 -> "permission denied, sign in again"). The client toasts `result.error` on `{ok:false}`.
- **Audit every meaningful mutation** and `revalidatePath` every surface the change affects (the admin list AND any public page, e.g. `/blog`).

## The form (client component, shared by new + edit)

One `<Resource>Form` component takes optional `initialData`. `new/page.tsx` renders it empty; `[id]/edit/page.tsx` fetches the row and passes it in. The form uses controlled inputs, validates, and on submit either inserts or updates via the browser Supabase client (RLS enforced) or a server action. The posts form additionally does localStorage autosave + restore and an optional AI-generate modal — both are opt-in extras, not required by the pattern.

## Shared building blocks (`source/components/admin/`)

- `RowDeleteButton` — confirm dialog + bound delete action + toast. Drop into any table row.
- `ToggleButton` — optimistic on/off (publish/draft, active/inactive). Takes a bound server action.
- `ConfirmDialog` / `ModalShell` — accessible modal with focus trap, escape, backdrop dismiss.
- `SubmitButton` — disables while the form action is pending (`useFormStatus`).
- `ImageUploader` — uploads to the `blog-images` Storage bucket, returns the public URL.

## Checklist: add a new resource

1. **Table + RLS** in the migration. Copy an existing block (e.g. `job_openings`): add the table, the `set_updated_at` trigger, indexes, and the five-policy RLS set (anon read of your "public" flag, admin-or-above read/insert/update/delete).
2. **Folder** `app/(admin)/admin/<resource>/` with `page.tsx`, `actions.ts`, `<Resource>Form.tsx`, `new/page.tsx`, `[id]/edit/page.tsx`. Copy `jobs/` as the simplest template.
3. **Nav entry** in `AdminSidebar.tsx` (`navSections`), gated by `adminOnly`/`superAdminOnly` as needed.
4. **Audit actions**: add `'<resource>.create' | '.update' | '.delete'` to the `AuditAction` union in `lib/auth/audit.ts` and to the audit-log view's filter.
5. **(Optional)** a `lib/supabase/<resource>.ts` data helper and `revalidatePath` of any public route the resource renders on.

That is the whole pattern. The kit ships four instances of it so you can diff them.
