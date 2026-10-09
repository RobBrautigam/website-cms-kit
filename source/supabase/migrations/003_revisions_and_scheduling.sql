-- ============================================================================
-- Website CMS Kit - revisions, scheduled publishing, and the whole lock
-- ============================================================================
-- Run after 002_hardening.sql. Idempotent, so it is safe to re-run. It
-- replaces two things earlier files set up (the public read policy on
-- blog_posts from 000, and the two-person lock from 002): if you ever re-run
-- 000, 001 or 002, run this file again after it.
-- Tests: source/supabase/tests/revisions.test.mjs.
--
--   19. The two-person lock made whole: with review required, the image
--       buckets and url_redirects are inside it too.
--   20. Revisions: every change to what a live post shows keeps a copy (who,
--       when, which fields), the newest 100 per post.
--   21. Scheduled publish and unpublish: an end date on posts, visitors see a
--       post exactly in its window, and a scheduler function (run by pg_cron
--       every minute when the extension is on) keeps the status true.
--   22. Two server-only ledgers: which images the kit made public, and every
--       optional AI call (the spend record).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 19a. Image buckets inside the lock
-- ----------------------------------------------------------------------------
-- With review required (public.staging_review_required(), 001), an admin can
-- no longer write the public blog-images bucket at all: only the server puts
-- files there, when it promotes a post's approved images
-- (lib/staging/promote-images.ts, on the service role). Taking a public file
-- down (delete) stays an ordinary admin right, like taking a post down.
-- Staged images become write-once: an admin can upload, but not overwrite or
-- delete and re-upload, so the file a teammate approved is the file that goes
-- public. Orphaned staged files are removed by the server
-- (lib/staging/orphans.ts). With review off, both buckets behave as before.
drop policy if exists "blog_images_admin_insert" on storage.objects;
create policy "blog_images_admin_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'blog-images' and public.is_admin_or_above(auth.uid())
              and not public.staging_review_required());

drop policy if exists "blog_images_admin_update" on storage.objects;
create policy "blog_images_admin_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'blog-images' and public.is_admin_or_above(auth.uid())
         and not public.staging_review_required())
  with check (bucket_id = 'blog-images' and public.is_admin_or_above(auth.uid())
              and not public.staging_review_required());

drop policy if exists "blog_images_staged_admin_update" on storage.objects;
create policy "blog_images_staged_admin_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'blog-images-staged' and public.is_admin_or_above(auth.uid())
         and not public.staging_review_required())
  with check (bucket_id = 'blog-images-staged' and public.is_admin_or_above(auth.uid())
              and not public.staging_review_required());

drop policy if exists "blog_images_staged_admin_delete" on storage.objects;
create policy "blog_images_staged_admin_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'blog-images-staged' and public.is_admin_or_above(auth.uid())
         and not public.staging_review_required());


-- ----------------------------------------------------------------------------
-- 19b. Redirects inside the lock
-- ----------------------------------------------------------------------------
-- A redirect can send a live post's address anywhere, so with review required
-- it takes two people too: a redirect an admin creates, or whose rule
-- (source, pattern, destination, permanent) an admin changes, is saved
-- switched off, with that admin recorded in changed_by; a different admin
-- switches it on. Switching one off, editing its notes or category, and
-- deleting it stay free. changed_by is always kept by this trigger, so turning
-- the lock on later works on existing rows; a client cannot set it. The
-- service role (the hit counter) and the table owner are not affected.
alter table public.url_redirects
  add column if not exists changed_by uuid references auth.users(id) on delete set null;

create or replace function public.url_redirects_two_person_lock()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT'
     or (new.source, new.is_pattern, new.destination, new.permanent)
        is distinct from (old.source, old.is_pattern, old.destination, old.permanent) then
    new.changed_by := auth.uid();
    if public.staging_review_required() then
      new.enabled := false;
    end if;
    return new;
  end if;

  new.changed_by := old.changed_by;
  if public.staging_review_required() and new.enabled and not old.enabled
     and old.changed_by is not distinct from auth.uid() then
    raise exception 'Review is required: a teammate switches on a redirect you created or changed.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.url_redirects_two_person_lock() from public, anon, authenticated;

drop trigger if exists url_redirects_two_person_lock on public.url_redirects;
create trigger url_redirects_two_person_lock
  before insert or update on public.url_redirects
  for each row execute function public.url_redirects_two_person_lock();


-- ----------------------------------------------------------------------------
-- 19c. The post lock (002, section 17), plus one free move
-- ----------------------------------------------------------------------------
-- 002's rules, unchanged, with one addition: pushing a scheduled post's date
-- later puts nothing on the site sooner, so it needs no approval (like taking
-- a post down). Pulling it earlier still does. Giving a post an end date
-- (unpublish_at, section 21) changes neither content nor status, so it is
-- free too.
create or replace function public.blog_posts_two_person_lock()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  was_live boolean;
  is_live boolean;
  content_changed boolean;
begin
  if not public.staging_review_required() then
    return new;
  end if;
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  is_live := new.status in ('published', 'scheduled');

  if tg_op = 'INSERT' then
    if is_live then
      raise exception 'Review is required: a new post starts as a draft. Stage it and ask a teammate to approve it.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  was_live := old.status in ('published', 'scheduled');
  content_changed :=
    (new.title, new.slug, new.excerpt, new.featured_image_url, new.featured_image_alt,
     new.body, new.categories, new.meta_description, new.author_slug)
    is distinct from
    (old.title, old.slug, old.excerpt, old.featured_image_url, old.featured_image_alt,
     old.body, old.categories, old.meta_description, old.author_slug);

  -- Drafts are not on the site.
  if not was_live and not is_live then
    return new;
  end if;
  -- Taking a post down, content as it is.
  if was_live and not is_live and not content_changed then
    return new;
  end if;
  -- Nothing the site shows changes.
  if not content_changed and new.status = old.status
     and new.published_at is not distinct from old.published_at then
    return new;
  end if;
  -- A scheduled post pushed later.
  if not content_changed and old.status = 'scheduled' and new.status = 'scheduled'
     and new.published_at > old.published_at then
    return new;
  end if;

  if exists (
    select 1 from public.blog_post_staged_changes as s
    where s.post_id = new.id
      and s.review_status = 'approved'
      and (s.title, s.slug, s.excerpt, s.featured_image_url, s.featured_image_alt,
           s.body, s.categories, s.meta_description, s.author_slug)
          is not distinct from
          (new.title, new.slug, new.excerpt, new.featured_image_url, new.featured_image_alt,
           new.body, new.categories, new.meta_description, new.author_slug)
  ) then
    return new;
  end if;

  raise exception 'Review is required: changes to a live post go through staging and a teammate''s approval.'
    using errcode = 'check_violation';
end;
$$;

revoke all on function public.blog_posts_two_person_lock() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 20. Revisions of live posts
-- ----------------------------------------------------------------------------
-- One row per change to a post that is live, scheduled, or was until this
-- change: publishing a staged copy, taking a post down, a scheduler run, a
-- direct edit with review off. Each row is the post as it became, who made
-- the change (null for the scheduler or a server job), when, and which fields
-- changed. Drafts keep no revisions (their autosaves would bury the history).
-- Restoring a revision copies it into the post's staged copy, so it goes
-- live through the same staging and review path as any edit
-- (restoreRevision in app/(admin)/admin/posts/actions.ts).
-- Admins read revisions; nobody edits them: only this trigger writes, and it
-- keeps the newest public.blog_post_revisions_kept() per post.
create table if not exists public.blog_post_revisions (
  id uuid primary key default gen_random_uuid(),
  -- Save order: saved_at can tie inside one transaction.
  seq bigint generated always as identity,
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  title text not null,
  slug text not null,
  excerpt text,
  featured_image_url text,
  featured_image_alt text,
  body jsonb not null default '{}'::jsonb,
  categories text[] not null default '{}',
  meta_description text,
  author_slug text,
  status text not null,
  published_at timestamptz,
  unpublish_at timestamptz,
  changed_fields text[] not null default '{}',
  saved_by uuid references auth.users(id) on delete set null,
  saved_at timestamptz not null default clock_timestamp()
);

create index if not exists blog_post_revisions_post_idx
  on public.blog_post_revisions (post_id, seq desc);

alter table public.blog_post_revisions enable row level security;
revoke all on table public.blog_post_revisions from public, anon, authenticated;
grant select on table public.blog_post_revisions to authenticated;
grant all on table public.blog_post_revisions to service_role;

drop policy if exists "blog_post_revisions_admin_read" on public.blog_post_revisions;
create policy "blog_post_revisions_admin_read"
  on public.blog_post_revisions for select to authenticated
  using (public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_post_revisions_require_mfa" on public.blog_post_revisions;
create policy "blog_post_revisions_require_mfa"
  on public.blog_post_revisions as restrictive for all to authenticated
  using (public.mfa_satisfied())
  with check (public.mfa_satisfied());

create or replace function public.blog_post_revisions_kept()
  returns integer
  language sql
  immutable
  set search_path = ''
as $$
  select 100;
$$;

revoke all on function public.blog_post_revisions_kept() from public, anon;
grant execute on function public.blog_post_revisions_kept() to authenticated, service_role;

-- Runs as its owner: the table has no write grant for any client role.
create or replace function public.blog_posts_keep_revision()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  changed text[] := '{}';
begin
  if tg_op = 'UPDATE' then
    if not (old.status in ('published', 'scheduled') or new.status in ('published', 'scheduled')) then
      return null;
    end if;
    if new.title is distinct from old.title then changed := array_append(changed, 'title'); end if;
    if new.slug is distinct from old.slug then changed := array_append(changed, 'slug'); end if;
    if new.excerpt is distinct from old.excerpt then changed := array_append(changed, 'excerpt'); end if;
    if new.featured_image_url is distinct from old.featured_image_url then changed := array_append(changed, 'featured_image_url'); end if;
    if new.featured_image_alt is distinct from old.featured_image_alt then changed := array_append(changed, 'featured_image_alt'); end if;
    if new.body is distinct from old.body then changed := array_append(changed, 'body'); end if;
    if new.categories is distinct from old.categories then changed := array_append(changed, 'categories'); end if;
    if new.meta_description is distinct from old.meta_description then changed := array_append(changed, 'meta_description'); end if;
    if new.author_slug is distinct from old.author_slug then changed := array_append(changed, 'author_slug'); end if;
    if new.status is distinct from old.status then changed := array_append(changed, 'status'); end if;
    if new.published_at is distinct from old.published_at then changed := array_append(changed, 'published_at'); end if;
    if new.unpublish_at is distinct from old.unpublish_at then changed := array_append(changed, 'unpublish_at'); end if;
    if cardinality(changed) = 0 then
      return null;
    end if;
  else
    if new.status not in ('published', 'scheduled') then
      return null;
    end if;
    changed := array['title', 'slug', 'body', 'status'];
  end if;

  insert into public.blog_post_revisions (
    post_id, title, slug, excerpt, featured_image_url, featured_image_alt, body,
    categories, meta_description, author_slug, status, published_at, unpublish_at,
    changed_fields, saved_by
  ) values (
    new.id, new.title, new.slug, new.excerpt, new.featured_image_url, new.featured_image_alt, new.body,
    new.categories, new.meta_description, new.author_slug, new.status, new.published_at, new.unpublish_at,
    changed, auth.uid()
  );

  delete from public.blog_post_revisions
  where post_id = new.id
    and id not in (
      select id from public.blog_post_revisions
      where post_id = new.id
      order by seq desc
      limit public.blog_post_revisions_kept()
    );
  return null;
end;
$$;

revoke all on function public.blog_posts_keep_revision() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 21. Scheduled publish and unpublish
-- ----------------------------------------------------------------------------
-- unpublish_at is a post's end date. Visitors (the anon key) see a post while
-- it is published, or scheduled and due, and before its end date, so the site
-- is right to the second even if the scheduler is late or not set up. The
-- scheduler function then makes the status say so: due scheduled posts become
-- published, posts past their end date go back to draft (end date cleared),
-- each with an audit row from 'scheduler' and a revision.
alter table public.blog_posts add column if not exists unpublish_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.blog_posts'::regclass
      and conname = 'blog_posts_unpublish_after_publish'
  ) then
    alter table public.blog_posts
      add constraint blog_posts_unpublish_after_publish
      check (unpublish_at is null or published_at is null or unpublish_at > published_at);
  end if;
end
$$;

create index if not exists blog_posts_unpublish_at_idx
  on public.blog_posts (unpublish_at) where unpublish_at is not null;

drop trigger if exists blog_posts_keep_revision on public.blog_posts;
create trigger blog_posts_keep_revision
  after insert or update on public.blog_posts
  for each row execute function public.blog_posts_keep_revision();

drop policy if exists "blog_posts_public_read_published" on public.blog_posts;
create policy "blog_posts_public_read_published"
  on public.blog_posts for select
  to anon
  using (
    (status = 'published' or (status = 'scheduled' and published_at <= now()))
    and (unpublish_at is null or unpublish_at > now())
  );

-- Runs as its owner, so the two-person lock (which binds client roles only)
-- lets it through: a post reaches 'scheduled' only through the lock, and the
-- content it goes live with is the content that was approved.
create or replace function public.run_scheduled_publishing()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  p record;
  published int := 0;
  unpublished int := 0;
begin
  for p in
    update public.blog_posts
      set status = 'published'
      where status = 'scheduled' and published_at <= now()
      returning id, title, slug
  loop
    insert into public.admin_audit_log (actor_email, action, resource_type, resource_id, payload)
    values ('scheduler', 'blog_post.scheduled_publish', 'blog_post', p.id::text,
            jsonb_build_object('title', p.title, 'slug', p.slug));
    published := published + 1;
  end loop;

  for p in
    update public.blog_posts
      set status = 'draft', unpublish_at = null
      where status = 'published' and unpublish_at <= now()
      returning id, title, slug
  loop
    insert into public.admin_audit_log (actor_email, action, resource_type, resource_id, payload)
    values ('scheduler', 'blog_post.scheduled_unpublish', 'blog_post', p.id::text,
            jsonb_build_object('title', p.title, 'slug', p.slug));
    unpublished := unpublished + 1;
  end loop;

  return jsonb_build_object('published', published, 'unpublished', unpublished);
end;
$$;

revoke all on function public.run_scheduled_publishing() from public, anon, authenticated;
grant execute on function public.run_scheduled_publishing() to service_role;

-- Every minute, when pg_cron is on (Supabase: Integrations -> Cron, or
-- `create extension if not exists pg_cron;`, then re-run this file). Without
-- it, visitors still see the right posts (the policy above); only the status
-- in the admin lags until something calls the function. docs/12 has the
-- host-scheduler alternative.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.schedule('cms-kit-scheduled-publishing', '* * * * *', 'select public.run_scheduled_publishing()')$cron$;
  end if;
end
$$;


-- ----------------------------------------------------------------------------
-- 22. Server-only ledgers
-- ----------------------------------------------------------------------------
-- Which image paths the kit itself made public. promoteImages() refuses to
-- treat an existing public file as promoted unless it is listed here, so a
-- file placed in blog-images some other way never stands in for an approved
-- image.
create table if not exists public.blog_image_promotions (
  path text primary key,
  post_id uuid,
  promoted_at timestamptz not null default now()
);

alter table public.blog_image_promotions enable row level security;
revoke all on table public.blog_image_promotions from public, anon, authenticated;
grant all on table public.blog_image_promotions to service_role;

-- One row per optional AI call: reserved as 'started' before the model is
-- called, then settled with the tokens it used ('ok'), or 'refused' when the
-- API turned it down. A call that times out or drops stays 'started', since
-- it may have been billed. The daily cap itself is a rate-limit bucket
-- (lib/security/rate-limit.ts); this is the record of what was spent.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  route text not null,
  model text,
  status text not null default 'started' check (status in ('started', 'ok', 'refused')),
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from public, anon, authenticated;
grant all on table public.ai_usage to service_role;
