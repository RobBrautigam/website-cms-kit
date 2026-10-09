-- ============================================================================
-- Website CMS Kit - hardening
-- ============================================================================
-- Run after 001_staging_and_approval.sql. Idempotent, so it is safe to re-run.
-- It replaces publish_staged_posts() from 001 and tightens two things 000
-- sets up (who may call increment_redirect_hit(), and the two-factor rule on
-- image uploads): if you ever re-run 000 or 001, run this file again after
-- it. Tests: source/supabase/tests/hardening.test.mjs.
--
--   14. The audit log is append-only by trigger, not only by policy.
--   15. Per-caller rate limits (the AI routes, the redirect counter), kept in
--       the database so they survive a restart and hold across servers.
--   16. A slug swap between two staged changes publishes in one batch.
--   17. The opt-in two-person lock: with review required, no post's content
--       or status reaches the live site without a second admin's approval
--       (posts only: images, redirects and the other tables are outside it).
--   18. Images uploaded for a staged change stay private until publish.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 14. admin_audit_log: append-only, enforced by a trigger
-- ----------------------------------------------------------------------------
-- Section 7 gives no role but the server a write policy, but the service-role
-- key and the table owner bypass RLS. These triggers refuse every UPDATE,
-- DELETE and TRUNCATE whoever runs it, with two exceptions:
--   - deleting rows older than the retention window (section D of 000), so a
--     retention job keeps working, while recent history cannot be erased;
--   - clearing actor_user_id when that user is deleted (the foreign key's
--     ON DELETE SET NULL), so deleting a user does not fail; the row keeps
--     actor_email and everything else. Only once the user is really gone:
--     clearing it by hand while the user exists is refused.
-- The check function runs as its owner so it can look in auth.users; it
-- returns a trigger, so nobody can call it directly.
-- The table owner can still disable a trigger; ship rows to external storage
-- if you need evidence that survives the database owner.
create or replace function public.admin_audit_log_retention()
  returns interval
  language sql
  immutable
  set search_path = ''
as $$
  select interval '24 months';
$$;

revoke all on function public.admin_audit_log_retention() from public, anon;
grant execute on function public.admin_audit_log_retention() to authenticated, service_role;

create or replace function public.admin_audit_log_append_only()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.created_at < now() - public.admin_audit_log_retention() then
      return old;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.actor_user_id is not null and new.actor_user_id is null
       and to_jsonb(new) - 'actor_user_id' = to_jsonb(old) - 'actor_user_id'
       and not exists (select 1 from auth.users where id = old.actor_user_id) then
      return new;
    end if;
  end if;
  raise exception 'The audit log is append-only: rows cannot be changed or deleted.'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.admin_audit_log_append_only() from public, anon, authenticated;

drop trigger if exists admin_audit_log_append_only on public.admin_audit_log;
create trigger admin_audit_log_append_only
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_append_only();

drop trigger if exists admin_audit_log_no_truncate on public.admin_audit_log;
create trigger admin_audit_log_no_truncate
  before truncate on public.admin_audit_log
  for each statement execute function public.admin_audit_log_append_only();


-- ----------------------------------------------------------------------------
-- 15. Per-caller rate limits
-- ----------------------------------------------------------------------------
-- One row per (bucket, caller): a fixed window and the hits inside it. Only
-- the server (service role) spends or reads it; the limits themselves live in
-- the app (lib/security/rate-limit.ts). Rows are tiny and one per caller;
-- prune old ones with
--   delete from public.api_rate_limits where window_started_at < now() - interval '1 day';
create table if not exists public.api_rate_limits (
  bucket text not null,
  caller text not null,
  window_started_at timestamptz not null default now(),
  hits integer not null default 0,
  primary key (bucket, caller)
);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from public, anon, authenticated;
grant all on table public.api_rate_limits to service_role;

-- Counts one hit for the caller and answers whether it is inside the limit.
-- Atomic (one upsert), so two servers cannot both pass the last slot.
create or replace function public.consume_rate_limit(
  bucket_name text,
  caller_key text,
  max_hits integer,
  window_seconds integer
)
  returns boolean
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  used integer;
  window_length interval;
begin
  if bucket_name is null or caller_key is null or max_hits is null or max_hits < 1
     or window_seconds is null or window_seconds < 1 then
    raise exception 'consume_rate_limit needs a bucket, a caller, and a positive limit and window.'
      using errcode = 'invalid_parameter_value';
  end if;
  window_length := make_interval(secs => window_seconds);

  insert into public.api_rate_limits as r (bucket, caller, window_started_at, hits)
  values (bucket_name, left(caller_key, 200), now(), 1)
  on conflict (bucket, caller) do update
    set hits = case when r.window_started_at <= now() - window_length then 1 else r.hits + 1 end,
        window_started_at = case when r.window_started_at <= now() - window_length then now() else r.window_started_at end
  returning hits into used;

  return used <= max_hits;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;

-- The redirect counter. 000 let the public key call increment_redirect_hit()
-- directly, so anyone could inflate any count. Now only the server counts a
-- hit, through this function: per caller (the visitor's address, read by the
-- server from the header your host sets) and with a ceiling per redirect, so
-- rotating made-up addresses can add at most the ceiling to one redirect per
-- window. An id that is not a redirect is refused before anything is
-- written, so made-up ids cannot grow api_rate_limits. Returns whether the
-- hit was counted.
create or replace function public.record_redirect_hit(
  redirect_id uuid,
  caller_key text,
  per_caller_max integer,
  per_redirect_max integer,
  window_seconds integer
)
  returns boolean
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if not exists (select 1 from public.url_redirects where id = redirect_id) then
    return false;
  end if;
  if not public.consume_rate_limit('redirect_hit', coalesce(nullif(caller_key, ''), 'unknown') || ':' || redirect_id, per_caller_max, window_seconds) then
    return false;
  end if;
  if not public.consume_rate_limit('redirect_hit_total', redirect_id::text, per_redirect_max, window_seconds) then
    return false;
  end if;
  update public.url_redirects
    set hit_count = hit_count + 1, last_access = now()
    where id = redirect_id;
  return found;
end;
$$;

revoke all on function public.record_redirect_hit(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.record_redirect_hit(uuid, text, integer, integer, integer) to service_role;

revoke all on function public.increment_redirect_hit(uuid) from public, anon, authenticated;
grant execute on function public.increment_redirect_hit(uuid) to service_role;


-- ----------------------------------------------------------------------------
-- 16. Slugs are checked at the end of a publish, so two posts can swap
-- ----------------------------------------------------------------------------
-- The unique slug becomes DEFERRABLE INITIALLY IMMEDIATE: every ordinary write
-- is checked at once, as before; publish_staged_posts() defers the check to
-- the end of its own batch, then checks it, so a real clash still fails the
-- whole batch inside the function. (A deferrable unique constraint cannot be
-- an ON CONFLICT target; the kit has no upsert on slug.)
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.blog_posts'::regclass
      and conname = 'blog_posts_slug_key'
      and not condeferrable
  ) then
    alter table public.blog_posts drop constraint blog_posts_slug_key;
    alter table public.blog_posts
      add constraint blog_posts_slug_key unique (slug) deferrable initially immediate;
  end if;
end
$$;

-- 001's function, plus the deferred slug check. Still SECURITY INVOKER: RLS
-- on both tables and the two-person lock below apply to the caller.
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

  set constraints public.blog_posts_slug_key deferred;

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

  -- Check the slugs now, so a clash fails here with 23505, not at commit.
  set constraints public.blog_posts_slug_key immediate;
end;
$$;

revoke all on function public.publish_staged_posts(uuid[]) from public, anon;
grant execute on function public.publish_staged_posts(uuid[]) to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 17. The two-person lock (opt-in, the same switch as 001's mandatory review)
-- ----------------------------------------------------------------------------
-- With public.staging_review_required() returning true, a signed-in admin
-- (role `authenticated`, the Data API and the cookie session alike) can no
-- longer change a post's content or status on the public site except by
-- publishing a change a second admin approved. The lock covers blog_posts
-- only: image files, url_redirects, testimonials and the other tables stay
-- under ordinary admin rights.
--   - a new post starts as a draft (not published, not scheduled);
--   - a draft's content can be edited freely (it is not on the site);
--   - a live or scheduled post can be taken down (back to draft, content as
--     it is), or deleted;
--   - any other change to a live or scheduled post, and any change that makes
--     a post live or scheduled, must carry exactly the content of an approved
--     staged change for that post. publish_staged_posts() is the normal way;
--     it applies the approved copy before deleting it, so the check passes.
-- The service role and the table owner are not affected (server jobs,
-- migrations). With the switch off (the default) the trigger does nothing.
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

drop trigger if exists blog_posts_two_person_lock on public.blog_posts;
create trigger blog_posts_two_person_lock
  before insert or update on public.blog_posts
  for each row execute function public.blog_posts_two_person_lock();


-- ----------------------------------------------------------------------------
-- 18. A private bucket for images uploaded while editing
-- ----------------------------------------------------------------------------
-- The editor uploads here, not to the public blog-images bucket. The content
-- stores the image's final public address from the start; the object waits
-- here, readable only by active admins (through signed URLs) until the post
-- is published, when the server copies it into blog-images
-- (lib/staging/images.ts and the publish actions). Same limits as blog-images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'blog-images-staged', 'blog-images-staged', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "blog_images_staged_admin_read" on storage.objects;
create policy "blog_images_staged_admin_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'blog-images-staged' and public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_images_staged_admin_insert" on storage.objects;
create policy "blog_images_staged_admin_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'blog-images-staged' and public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_images_staged_admin_update" on storage.objects;
create policy "blog_images_staged_admin_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'blog-images-staged' and public.is_admin_or_above(auth.uid()))
  with check (bucket_id = 'blog-images-staged' and public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_images_staged_admin_delete" on storage.objects;
create policy "blog_images_staged_admin_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'blog-images-staged' and public.is_admin_or_above(auth.uid()));

-- Section 10's two-factor rule, widened to cover both image buckets.
drop policy if exists "blog_images_require_mfa" on storage.objects;
create policy "blog_images_require_mfa"
  on storage.objects as restrictive for all to authenticated
  using (bucket_id not in ('blog-images', 'blog-images-staged') or public.mfa_satisfied())
  with check (bucket_id not in ('blog-images', 'blog-images-staged') or public.mfa_satisfied());
