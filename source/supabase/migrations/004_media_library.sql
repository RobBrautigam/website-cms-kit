-- ============================================================================
-- Website CMS Kit - the media library
-- ============================================================================
-- Run after 003_revisions_and_scheduling.sql. Idempotent, so it is safe to
-- re-run. It replaces the two image delete policies (000 section 9 and 003
-- section 19a): if you ever re-run 000, 002 or 003, run this file again after
-- it.
-- Tests: source/supabase/tests/media.test.mjs.
--
--   23. Alt text per asset: one row per image file, kept by admins, offered
--       when the image is picked again for another post.
--   24. A used image is never deleted: an admin cannot delete a file a post,
--       a staged copy, a kept revision or a testimonial still shows, in either
--       bucket.
--
-- Nothing here touches the promotion ledger (003 section 22): the server's
-- promotion stays the only way into the public bucket while review is
-- required, and staged images stay write-once under review.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 23. Alt text per asset
-- ----------------------------------------------------------------------------
-- The text a screen reader says for the image, kept once per file. Picking the
-- image again for another post offers this text, and each post still keeps its
-- own copy in its content (an edit here never rewrites a live post, which the
-- two-person lock compares byte for byte). The row grants nothing in storage:
-- it is a label, not a door.
create table if not exists public.blog_media (
  path text primary key
    check (path ~ '^blog/[A-Za-z0-9-]{8,64}\.(jpg|png|webp|gif)$'),
  alt text not null default '' check (char_length(alt) <= 200),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Who changed it and when come from the session, never from the client.
create or replace function public.blog_media_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- No client calls it; the trigger still fires (EXECUTE is checked when the
-- trigger is created, by the migration's owner).
revoke all on function public.blog_media_stamp() from public, anon, authenticated;

drop trigger if exists blog_media_stamp on public.blog_media;
create trigger blog_media_stamp
  before insert or update on public.blog_media
  for each row execute procedure public.blog_media_stamp();

alter table public.blog_media enable row level security;
revoke all on table public.blog_media from public, anon, authenticated;
-- Column grants: a client names the file and its text, nothing else, and
-- never deletes the row (the server does, when the file itself goes).
grant select on table public.blog_media to authenticated;
grant insert (path, alt) on table public.blog_media to authenticated;
grant update (alt) on table public.blog_media to authenticated;
grant all on table public.blog_media to service_role;

drop policy if exists "blog_media_admin_select" on public.blog_media;
create policy "blog_media_admin_select"
  on public.blog_media for select to authenticated
  using (public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_media_admin_insert" on public.blog_media;
create policy "blog_media_admin_insert"
  on public.blog_media for insert to authenticated
  with check (public.is_admin_or_above(auth.uid()));

drop policy if exists "blog_media_admin_update" on public.blog_media;
create policy "blog_media_admin_update"
  on public.blog_media for update to authenticated
  using (public.is_admin_or_above(auth.uid()))
  with check (public.is_admin_or_above(auth.uid()));

-- Section 10's two-factor rule (000): no admin data on a password alone.
drop policy if exists "blog_media_require_mfa" on public.blog_media;
create policy "blog_media_require_mfa"
  on public.blog_media as restrictive for all to authenticated
  using (public.mfa_satisfied())
  with check (public.mfa_satisfied());


-- ----------------------------------------------------------------------------
-- 24. A used image is never deleted
-- ----------------------------------------------------------------------------
-- True when any post, staged copy, kept revision or testimonial holds the
-- file's public URL (content always stores the final public URL, staged or
-- not, so one test covers both buckets). SECURITY DEFINER so the storage policies below can
-- ask it for an admin who cannot read every table it looks at; it answers
-- yes or no and returns nothing else.
create or replace function public.blog_image_in_use(image_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blog_posts p
    where strpos(coalesce(p.featured_image_url, ''), '/blog-images/' || image_path) > 0
       or strpos(coalesce(p.body::text, ''), '/blog-images/' || image_path) > 0
  ) or exists (
    select 1 from public.blog_post_staged_changes s
    where strpos(coalesce(s.featured_image_url, ''), '/blog-images/' || image_path) > 0
       or strpos(coalesce(s.body::text, ''), '/blog-images/' || image_path) > 0
  ) or exists (
    select 1 from public.blog_post_revisions r
    where strpos(coalesce(r.featured_image_url, ''), '/blog-images/' || image_path) > 0
       or strpos(coalesce(r.body::text, ''), '/blog-images/' || image_path) > 0
  ) or exists (
    -- Testimonials upload through the same picker into the same buckets.
    select 1 from public.testimonials t
    where strpos(coalesce(t.headshot_url, ''), '/blog-images/' || image_path) > 0
       or strpos(coalesce(t.screenshot_url, ''), '/blog-images/' || image_path) > 0
       or strpos(coalesce(t.video_thumbnail_url, ''), '/blog-images/' || image_path) > 0
  );
$$;

revoke all on function public.blog_image_in_use(text) from public, anon;
grant execute on function public.blog_image_in_use(text) to authenticated, service_role;

-- The public bucket: taking an unused file down stays an admin right (003
-- section 19a). A used one is refused: take its post down, or change the post,
-- first. The server (service role) is not bound by these policies.
drop policy if exists "blog_images_admin_delete" on storage.objects;
create policy "blog_images_admin_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'blog-images' and public.is_admin_or_above(auth.uid())
         and not public.blog_image_in_use(name));

-- The staged bucket: still write-once while review is required (003 section
-- 19a), and never a file something still uses.
drop policy if exists "blog_images_staged_admin_delete" on storage.objects;
create policy "blog_images_staged_admin_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'blog-images-staged' and public.is_admin_or_above(auth.uid())
         and not public.staging_review_required()
         and not public.blog_image_in_use(name));
