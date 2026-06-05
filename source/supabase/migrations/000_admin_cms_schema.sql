-- ============================================================================
-- Website CMS Kit — consolidated schema
-- ============================================================================
-- Run this once in your Supabase SQL editor (Dashboard -> SQL Editor) on a
-- fresh project. It stands up the whole admin CMS: roles + RLS, the content
-- tables (posts, jobs, testimonials, redirects), the audit log, and the MFA
-- recovery-code store.
--
-- This is the clean END STATE consolidated from an incrementally-migrated
-- production app. Idempotent where practical (IF NOT EXISTS / OR REPLACE), so
-- it is safe to re-run.
--
-- Security model (three layers, each sufficient to deny on its own):
--   1. Proxy gate      — refreshes the session, bounces unauthenticated /admin/*
--   2. requireAdmin()  — re-checks user + role + deactivation + MFA per request
--   3. RLS (this file) — the DB itself only allows admin-or-above writes and
--                        anon reads of PUBLIC rows. A leaked anon key can read
--                        published content but cannot mutate anything.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Shared updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ----------------------------------------------------------------------------
-- 1. user_roles  (authorization source of truth)
-- ----------------------------------------------------------------------------
-- One row per admin user. `editor` is reserved in the CHECK constraint as a
-- future third tier but is granted no capability today (the app gates on
-- super_admin / admin only). `deactivated_at` is a soft-deactivation flag:
-- a deactivated row keeps history but loses all access.
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin', 'editor')),
  deactivated_at timestamptz,
  created_at timestamptz not null default now()
);

-- Most queries filter to active users.
create index if not exists user_roles_active_idx
  on public.user_roles (user_id) where deactivated_at is null;

alter table public.user_roles enable row level security;


-- ----------------------------------------------------------------------------
-- 2. SECURITY DEFINER role helpers (non-recursive RLS support)
-- ----------------------------------------------------------------------------
-- RLS policies on user_roles cannot SELECT user_roles directly (infinite
-- recursion). These helpers run as the function owner and bypass RLS, which is
-- the canonical Supabase pattern for self-referential authorization checks.
create or replace function public.is_super_admin(uid uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid
      and role = 'super_admin'
      and deactivated_at is null
  );
$$;

create or replace function public.is_admin_or_above(uid uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid
      and role in ('super_admin', 'admin')
      and deactivated_at is null
  );
$$;

revoke all on function public.is_super_admin(uuid) from public;
revoke all on function public.is_admin_or_above(uuid) from public;
grant execute on function public.is_super_admin(uuid) to authenticated, service_role;
grant execute on function public.is_admin_or_above(uuid) to authenticated, service_role;

-- user_roles policies: a user can read their own row; only super_admins read
-- everyone's or write at all. (Most writes happen via the service-role client
-- in the /api/admin/users/* routes, which bypasses RLS — these policies are
-- the defense-in-depth backstop.)
drop policy if exists "user_roles_self_or_super_admin_read" on public.user_roles;
create policy "user_roles_self_or_super_admin_read"
  on public.user_roles for select
  using (auth.uid() = user_id or public.is_super_admin(auth.uid()));

drop policy if exists "user_roles_super_admin_write" on public.user_roles;
create policy "user_roles_super_admin_write"
  on public.user_roles for all
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));


-- ----------------------------------------------------------------------------
-- 3. blog_posts
-- ----------------------------------------------------------------------------
create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  -- Author is referenced by a slug string (wire it to your own users/authors
  -- source). author_id is kept nullable for sites that add an authors table.
  author_id uuid,
  author_slug text,
  published_at timestamptz,
  excerpt text,
  featured_image_url text,
  featured_image_alt text,
  body jsonb not null default '{}'::jsonb,   -- TipTap document JSON
  categories text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published', 'scheduled')),
  meta_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blog_posts_status_idx on public.blog_posts (status);
create index if not exists blog_posts_slug_idx on public.blog_posts (slug);
create index if not exists blog_posts_published_at_idx on public.blog_posts (published_at desc);

drop trigger if exists set_blog_posts_updated_at on public.blog_posts;
create trigger set_blog_posts_updated_at
  before update on public.blog_posts
  for each row execute procedure public.set_updated_at();

alter table public.blog_posts enable row level security;

-- Anon reads published posts only. (If you publish on a schedule, add a second
-- anon policy: USING (status = 'scheduled' AND published_at <= now()).)
drop policy if exists "blog_posts_public_read_published" on public.blog_posts;
create policy "blog_posts_public_read_published"
  on public.blog_posts for select
  to anon
  using (status = 'published');

drop policy if exists "blog_posts_admin_read_all" on public.blog_posts;
create policy "blog_posts_admin_read_all"
  on public.blog_posts for select to authenticated
  using (public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_posts_admin_insert" on public.blog_posts;
create policy "blog_posts_admin_insert"
  on public.blog_posts for insert to authenticated
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_posts_admin_update" on public.blog_posts;
create policy "blog_posts_admin_update"
  on public.blog_posts for update to authenticated
  using (public.is_admin_or_above(auth.uid()))
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_posts_admin_delete" on public.blog_posts;
create policy "blog_posts_admin_delete"
  on public.blog_posts for delete to authenticated
  using (public.is_admin_or_above(auth.uid()));


-- ----------------------------------------------------------------------------
-- 4. job_openings  (example resource: careers)
-- ----------------------------------------------------------------------------
create table if not exists public.job_openings (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  department text not null,
  type text not null,
  location text not null default 'Remote',
  summary text not null,
  responsibilities jsonb not null default '[]'::jsonb,
  qualifications jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  seo_title text,
  seo_description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_openings_is_active_idx on public.job_openings (is_active);
create index if not exists job_openings_department_idx on public.job_openings (department);
create index if not exists job_openings_sort_order_idx on public.job_openings (sort_order);

drop trigger if exists set_job_openings_updated_at on public.job_openings;
create trigger set_job_openings_updated_at
  before update on public.job_openings
  for each row execute procedure public.set_updated_at();

alter table public.job_openings enable row level security;

drop policy if exists "job_openings_public_read_active" on public.job_openings;
create policy "job_openings_public_read_active"
  on public.job_openings for select to anon
  using (is_active = true);

drop policy if exists "job_openings_admin_read_all" on public.job_openings;
create policy "job_openings_admin_read_all"
  on public.job_openings for select to authenticated
  using (public.is_admin_or_above(auth.uid()));

drop policy if exists "job_openings_admin_insert" on public.job_openings;
create policy "job_openings_admin_insert"
  on public.job_openings for insert to authenticated
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "job_openings_admin_update" on public.job_openings;
create policy "job_openings_admin_update"
  on public.job_openings for update to authenticated
  using (public.is_admin_or_above(auth.uid()))
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "job_openings_admin_delete" on public.job_openings;
create policy "job_openings_admin_delete"
  on public.job_openings for delete to authenticated
  using (public.is_admin_or_above(auth.uid()));


-- ----------------------------------------------------------------------------
-- 5. testimonials  (example resource: text + video proof)
-- ----------------------------------------------------------------------------
create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),

  -- traceability + idempotent re-import from an external collection tool
  external_id text,
  source text not null default 'manual',

  -- content
  kind text not null check (kind in ('text', 'video')),
  name text not null,
  tagline text,
  company text,
  headshot_url text,
  screenshot_url text,
  quote text not null,
  headline text,
  rating int check (rating between 1 and 5),
  external_url text,
  email text,
  website_url text,
  linkedin_url text,

  -- video-specific (null for kind=text)
  video_url text,
  video_thumbnail_url text,
  video_transcript text,
  video_duration_sec real,
  video_aspect_ratio text,

  -- curation
  is_visible boolean not null default false,
  display_order int not null default 0,

  -- timestamps
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists testimonials_is_visible_idx on public.testimonials (is_visible);
create index if not exists testimonials_display_order_idx on public.testimonials (display_order);
create unique index if not exists testimonials_external_id_idx
  on public.testimonials (external_id) where external_id is not null;

drop trigger if exists set_testimonials_updated_at on public.testimonials;
create trigger set_testimonials_updated_at
  before update on public.testimonials
  for each row execute procedure public.set_updated_at();

alter table public.testimonials enable row level security;

drop policy if exists "testimonials_public_read_visible" on public.testimonials;
create policy "testimonials_public_read_visible"
  on public.testimonials for select to anon
  using (is_visible = true);

drop policy if exists "testimonials_admin_read_all" on public.testimonials;
create policy "testimonials_admin_read_all"
  on public.testimonials for select to authenticated
  using (public.is_admin_or_above(auth.uid()));

drop policy if exists "testimonials_admin_insert" on public.testimonials;
create policy "testimonials_admin_insert"
  on public.testimonials for insert to authenticated
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "testimonials_admin_update" on public.testimonials;
create policy "testimonials_admin_update"
  on public.testimonials for update to authenticated
  using (public.is_admin_or_above(auth.uid()))
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "testimonials_admin_delete" on public.testimonials;
create policy "testimonials_admin_delete"
  on public.testimonials for delete to authenticated
  using (public.is_admin_or_above(auth.uid()));


-- ----------------------------------------------------------------------------
-- 6. url_redirects  (example resource: redirect manager + hit telemetry)
-- ----------------------------------------------------------------------------
create table if not exists public.url_redirects (
  id uuid primary key default gen_random_uuid(),
  source text not null unique,        -- e.g. '/old-path' or '/blog/:slug'
  is_pattern boolean not null default false,
  destination text not null,          -- relative path or absolute URL
  permanent boolean not null default true,   -- 308 vs 307
  enabled boolean not null default true,
  category text,
  notes text,
  hit_count bigint not null default 0,
  last_access timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists url_redirects_enabled_idx on public.url_redirects (enabled);
create index if not exists url_redirects_last_access_idx on public.url_redirects (last_access desc nulls last);
create index if not exists url_redirects_category_idx on public.url_redirects (category) where category is not null;

drop trigger if exists set_url_redirects_updated_at on public.url_redirects;
create trigger set_url_redirects_updated_at
  before update on public.url_redirects
  for each row execute procedure public.set_updated_at();

alter table public.url_redirects enable row level security;

-- Anon reads enabled redirects (the proxy needs this to resolve a redirect for
-- an unauthenticated visitor).
drop policy if exists "url_redirects_anon_read_enabled" on public.url_redirects;
create policy "url_redirects_anon_read_enabled"
  on public.url_redirects for select to anon
  using (enabled = true);

drop policy if exists "url_redirects_admin_read_all" on public.url_redirects;
create policy "url_redirects_admin_read_all"
  on public.url_redirects for select to authenticated
  using (public.is_admin_or_above(auth.uid()));

drop policy if exists "url_redirects_admin_insert" on public.url_redirects;
create policy "url_redirects_admin_insert"
  on public.url_redirects for insert to authenticated
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "url_redirects_admin_update" on public.url_redirects;
create policy "url_redirects_admin_update"
  on public.url_redirects for update to authenticated
  using (public.is_admin_or_above(auth.uid()))
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "url_redirects_admin_delete" on public.url_redirects;
create policy "url_redirects_admin_delete"
  on public.url_redirects for delete to authenticated
  using (public.is_admin_or_above(auth.uid()));

-- Hit counter RPC. SECURITY DEFINER lets the anon client increment without
-- needing UPDATE permission on the table itself (the proxy / beacon call it).
create or replace function public.increment_redirect_hit(redirect_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.url_redirects
  set hit_count = hit_count + 1, last_access = now()
  where id = redirect_id;
$$;

revoke all on function public.increment_redirect_hit(uuid) from public;
grant execute on function public.increment_redirect_hit(uuid) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 7. admin_audit_log  (append-only forensic record)
-- ----------------------------------------------------------------------------
-- Writes flow through recordAdminAction() using the SERVICE-ROLE client, so
-- there are no INSERT/UPDATE/DELETE policies for authenticated users — only
-- super_admins can read. Append-only by construction.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  actor_role text,
  action text not null,
  resource_type text,
  resource_id text,
  payload jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_actor_created_idx on public.admin_audit_log (actor_user_id, created_at desc);
create index if not exists admin_audit_log_action_created_idx on public.admin_audit_log (action, created_at desc);
create index if not exists admin_audit_log_resource_idx on public.admin_audit_log (resource_type, resource_id);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists "admin_audit_log_super_admin_read" on public.admin_audit_log;
create policy "admin_audit_log_super_admin_read"
  on public.admin_audit_log for select to authenticated
  using (public.is_super_admin(auth.uid()));


-- ----------------------------------------------------------------------------
-- 8. admin_mfa_recovery_codes  (bcrypt-hashed, single-use)
-- ----------------------------------------------------------------------------
-- NO RLS policies at all. Every access flows through the service-role helper in
-- lib/auth/mfa.ts. Locking it down here means even the owner cannot read their
-- own hashes through the anon/auth client.
create table if not exists public.admin_mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- One live (unused) hash per user; used codes stay for forensic history.
create unique index if not exists admin_mfa_recovery_codes_user_unused_idx
  on public.admin_mfa_recovery_codes (user_id, code_hash) where used_at is null;
create index if not exists admin_mfa_recovery_codes_user_idx
  on public.admin_mfa_recovery_codes (user_id);

alter table public.admin_mfa_recovery_codes enable row level security;


-- ============================================================================
-- POST-MIGRATION STEPS (do these in the dashboard / a follow-up query)
-- ============================================================================
--
-- A. Storage bucket for images (Dashboard -> Storage -> New bucket):
--      Name:               blog-images
--      Public:             ON
--      File size limit:    5 MB
--      Allowed MIME types: image/jpeg, image/png, image/webp, image/gif
--
-- B. Seed your first super-admin. Create the auth user first (Dashboard ->
--    Authentication -> Add user, OR invite them once a second super-admin
--    exists), then run — replacing the email:
--
--      insert into public.user_roles (user_id, role)
--      select id, 'super_admin' from auth.users
--      where email = 'admin@example.com'
--      on conflict (user_id) do update set role = 'super_admin', deactivated_at = null;
--
-- C. Supabase Auth config (Dashboard -> Authentication):
--      - URL Configuration -> Redirect URLs: add
--          https://YOUR_DOMAIN/admin/reset-password
--          https://YOUR_DOMAIN/admin/reset-password?context=invite
--      - Providers -> Email: keep "Confirm email" on; ensure email sending works
--        (the invite + recovery flows depend on it).
--      - Multi-Factor Auth: enable TOTP.
--
-- D. (Optional) Audit-log retention via pg_cron. Requires the pg_cron
--    extension (Dashboard -> Database -> Extensions -> enable "pg_cron").
--    Then:
--      create extension if not exists pg_cron;
--      select cron.schedule(
--        'admin_audit_log_retention',
--        '0 3 1 * *',  -- 03:00 on the 1st of each month
--        $$delete from public.admin_audit_log where created_at < now() - interval '24 months'$$
--      );
-- ============================================================================
