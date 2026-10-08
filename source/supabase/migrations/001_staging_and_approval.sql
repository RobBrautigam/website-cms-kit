-- ============================================================================
-- Website CMS Kit - staging and approval for blog posts
-- ============================================================================
-- Run after 000_admin_cms_schema.sql. Idempotent, so it is safe to re-run.
--
-- An edit to a post waits here, in a private copy, until someone publishes it.
-- The live blog_posts row is never touched before then. Full model:
-- docs/10-staging-and-approval.md. Tests: source/supabase/tests/.
--
-- Three locks keep a staged change off the public site:
--   1. anon has no privilege on the table at all (permission denied)
--   2. RLS is on and every policy is for active admins only
--   3. the public data layer (lib/data.ts) never reads this table
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 11. blog_post_staged_changes: one private staged copy per post
-- ----------------------------------------------------------------------------
create table if not exists public.blog_post_staged_changes (
  id uuid primary key default gen_random_uuid(),
  -- One staged copy per post. Deleting the post deletes its staged copy.
  post_id uuid not null unique references public.blog_posts(id) on delete cascade,

  -- The same editable fields as blog_posts.
  title text not null,
  slug text not null,
  excerpt text,
  featured_image_url text,
  featured_image_alt text,
  body jsonb not null default '{}'::jsonb,
  categories text[] not null default '{}',
  meta_description text,
  author_slug text,

  -- Review state. Written by the trigger below, never trusted from a client.
  review_status text not null default 'staged'
    check (review_status in ('staged', 'in_review', 'approved')),
  staged_by uuid references auth.users(id) on delete set null,
  staged_at timestamptz not null default now(),
  review_requested_by uuid references auth.users(id) on delete set null,
  review_requested_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blog_post_staged_changes_review_idx
  on public.blog_post_staged_changes (review_status, staged_at desc);

alter table public.blog_post_staged_changes enable row level security;

-- Lock 1: the public key gets nothing, not even a select that RLS would
-- filter to zero rows. (Supabase grants every new public table to anon by
-- default; this takes it back.)
-- Signed-in users get the four verbs RLS governs and nothing else (Supabase's
-- default grant also hands out TRUNCATE, which RLS does not cover).
revoke all on table public.blog_post_staged_changes from public, anon, authenticated;
grant select, insert, update, delete on table public.blog_post_staged_changes to authenticated;
grant all on table public.blog_post_staged_changes to service_role;

-- Lock 2: only active admins, and (section 10's rule) only on an AAL2 session
-- once they have a verified factor.
drop policy if exists "blog_post_staged_changes_admin_read" on public.blog_post_staged_changes;
create policy "blog_post_staged_changes_admin_read"
  on public.blog_post_staged_changes for select to authenticated
  using (public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_post_staged_changes_admin_insert" on public.blog_post_staged_changes;
create policy "blog_post_staged_changes_admin_insert"
  on public.blog_post_staged_changes for insert to authenticated
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_post_staged_changes_admin_update" on public.blog_post_staged_changes;
create policy "blog_post_staged_changes_admin_update"
  on public.blog_post_staged_changes for update to authenticated
  using (public.is_admin_or_above(auth.uid()))
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_post_staged_changes_admin_delete" on public.blog_post_staged_changes;
create policy "blog_post_staged_changes_admin_delete"
  on public.blog_post_staged_changes for delete to authenticated
  using (public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_post_staged_changes_require_mfa" on public.blog_post_staged_changes;
create policy "blog_post_staged_changes_require_mfa"
  on public.blog_post_staged_changes as restrictive for all to authenticated
  using (public.mfa_satisfied())
  with check (public.mfa_satisfied());


-- ----------------------------------------------------------------------------
-- 12. The review rules, enforced on every write
-- ----------------------------------------------------------------------------
-- The bookkeeping columns belong to this trigger. Whatever a client sends:
--   - a new staged change starts as 'staged', staged by the caller
--   - any content change sends it back to 'staged' and clears the review
--     request and the approval (an approval covers exact content)
--   - staged -> in_review records who asked
--   - in_review -> approved needs someone other than the person who staged it
--   - in_review or approved -> staged (withdraw) clears the review fields
--   - every other jump is refused
create or replace function public.blog_post_staged_changes_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.review_status := 'staged';
    new.staged_by := caller;
    new.staged_at := now();
    new.review_requested_by := null;
    new.review_requested_at := null;
    new.approved_by := null;
    new.approved_at := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.post_id is distinct from old.post_id then
    raise exception 'A staged change cannot move to another post.'
      using errcode = 'check_violation';
  end if;

  -- Start from the stored bookkeeping; only the branches below may change it.
  new.id := old.id;
  new.created_at := old.created_at;
  new.staged_by := old.staged_by;
  new.staged_at := old.staged_at;
  new.review_requested_by := old.review_requested_by;
  new.review_requested_at := old.review_requested_at;
  new.approved_by := old.approved_by;
  new.approved_at := old.approved_at;
  new.updated_at := now();

  if (new.title, new.slug, new.excerpt, new.featured_image_url, new.featured_image_alt,
      new.body, new.categories, new.meta_description, new.author_slug)
     is distinct from
     (old.title, old.slug, old.excerpt, old.featured_image_url, old.featured_image_alt,
      old.body, old.categories, old.meta_description, old.author_slug)
  then
    new.review_status := 'staged';
    new.staged_by := caller;
    new.staged_at := now();
    new.review_requested_by := null;
    new.review_requested_at := null;
    new.approved_by := null;
    new.approved_at := null;
    return new;
  end if;

  if new.review_status = old.review_status then
    return new;
  end if;

  if old.review_status = 'staged' and new.review_status = 'in_review' then
    new.review_requested_by := caller;
    new.review_requested_at := now();
  elsif old.review_status = 'in_review' and new.review_status = 'approved' then
    if caller is null then
      raise exception 'Only a signed-in admin can approve a staged change.'
        using errcode = 'check_violation';
    end if;
    -- A row written by a job or the service role has no stager; then the
    -- person who asked for the review counts as its author.
    if caller = coalesce(old.staged_by, old.review_requested_by) then
      raise exception 'You cannot approve a change you staged. Ask a teammate to approve it.'
        using errcode = 'check_violation';
    end if;
    new.approved_by := caller;
    new.approved_at := now();
  elsif new.review_status = 'staged' then
    new.review_requested_by := null;
    new.review_requested_at := null;
    new.approved_by := null;
    new.approved_at := null;
  else
    raise exception 'A staged change cannot go from % to %.', old.review_status, new.review_status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.blog_post_staged_changes_guard() from public, anon, authenticated;

drop trigger if exists blog_post_staged_changes_guard on public.blog_post_staged_changes;
create trigger blog_post_staged_changes_guard
  before insert or update on public.blog_post_staged_changes
  for each row execute procedure public.blog_post_staged_changes_guard();


-- ----------------------------------------------------------------------------
-- 13. Publishing: all or nothing, with the caller's own rights
-- ----------------------------------------------------------------------------
-- Review is opt-in per change by default: a change nobody asked to review can
-- be published at once ("Publish now"), and a change waiting in review cannot
-- be published while it stays in review (any admin can withdraw the request).
-- Changing `false` to `true` here makes this function refuse every staged
-- change that is not approved. It does NOT stop an admin writing blog_posts
-- directly (the editor's draft save, the posts list's publish button, or a
-- Data API call): a team that needs two-person control must also lock those
-- paths (docs/10, "Making review mandatory").
create or replace function public.staging_review_required()
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select false;
$$;

revoke all on function public.staging_review_required() from public, anon;
grant execute on function public.staging_review_required() to authenticated, service_role;

-- Copies each picked staged change onto its live post, marks the post
-- published (keeping its first published_at) and deletes the staged copy.
-- One call is one transaction: if any pick is refused, nothing is published.
-- SECURITY INVOKER on purpose: it runs as the caller, so RLS on both tables
-- (active admin, AAL2 once enrolled) decides, and the function adds no power
-- of its own to anyone who can reach it over the Data API.
create or replace function public.publish_staged_posts(stage_ids uuid[])
  returns setof uuid
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  s public.blog_post_staged_changes%rowtype;
  wanted int;
  published int := 0;
begin
  wanted := coalesce(cardinality(array(select distinct x from unnest(stage_ids) as x where x is not null)), 0);
  if wanted = 0 then
    raise exception 'Pick at least one staged change to publish.'
      using errcode = 'check_violation';
  end if;

  for s in
    select * from public.blog_post_staged_changes
    where id = any (stage_ids)
    order by staged_at
    for update
  loop
    if s.review_status = 'in_review'
       or (public.staging_review_required() and s.review_status <> 'approved') then
      raise exception '"%" needs an approval before it can be published. Nothing was published.', s.title
        using errcode = 'check_violation';
    end if;

    update public.blog_posts as p
      set title = s.title,
          slug = s.slug,
          excerpt = s.excerpt,
          featured_image_url = s.featured_image_url,
          featured_image_alt = s.featured_image_alt,
          body = s.body,
          categories = s.categories,
          meta_description = s.meta_description,
          author_slug = s.author_slug,
          -- A scheduled post keeps its date: publishing its staged copy
          -- updates the content it will go live with, not when.
          status = case when p.status = 'scheduled' then 'scheduled' else 'published' end,
          published_at = case
            when p.status = 'scheduled' then p.published_at
            when p.status = 'published' and p.published_at is not null then p.published_at
            else now()
          end
    where p.id = s.post_id;
    if not found then
      raise exception 'The post behind "%" could not be updated. Nothing was published.', s.title
        using errcode = 'no_data_found';
    end if;

    delete from public.blog_post_staged_changes where id = s.id;
    published := published + 1;
    return next s.post_id;
  end loop;

  if published <> wanted then
    raise exception 'Some picked changes were not found (published by someone else, or discarded). Nothing was published.'
      using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function public.publish_staged_posts(uuid[]) from public, anon;
grant execute on function public.publish_staged_posts(uuid[]) to authenticated, service_role;
