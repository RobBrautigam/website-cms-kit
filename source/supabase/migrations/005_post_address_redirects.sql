-- ============================================================================
-- 005: a live post's old address redirects to its new one, one hop, no loop
-- ============================================================================
-- Run after 004. Model: docs/14-seo-and-redirects.md.
--
-- When a live post's slug changes (a staged change published, a direct save,
-- the Data API, a scheduled publish), its old address would answer 404 and
-- every link and search result pointing at it would break. From this
-- migration, at the end of the transaction that changed it:
--
--   1. the old address gets a permanent redirect to the new one (category
--      'post-slug-change'), or an existing redirect from it is repointed;
--   2. every other static redirect that pointed at the old address is
--      repointed at the new one, so no visitor follows a chain of two hops;
--   3. a redirect FROM the new address is switched off, because it would send
--      visitors away from a live post (renaming a post back to an old slug);
--   4. one audit row says what was done.
--
-- It runs only for a post that was live at its old address and is live at its
-- new one (the same rule as the public read policy in 003): a draft has no
-- public address to keep. If another live post now owns the old address (two
-- posts swapped slugs in one publish), no redirect is made from it; the swap
-- is the editor's own choice, and the redirects pointing at either address are
-- left for a person to check.
--
-- It is a deferred constraint trigger, so it reads the table as the
-- transaction leaves it: a slug swap published in one batch (002, item 16) is
-- seen whole, never half done. Inside one transaction, `set constraints all
-- immediate` runs it at that moment (the tests do this).
--
-- With review required (001), the rename itself only reaches a live post with
-- a second admin's approval, so the redirect it causes is saved switched on;
-- it runs as the table owner, which 003's redirect lock does not hold back.
-- changed_by records the admin whose session made the change (null for the
-- scheduler).

create or replace function public.blog_post_path(post_slug text)
  returns text
  language sql
  immutable
  set search_path = ''
as $$
  -- Where posts live on the public site. Change it here (and BLOG_BASE_PATH
  -- in lib/seo/site.ts) if yours are not under /blog.
  select '/blog/' || post_slug
$$;

create or replace function public.blog_post_is_live(
  post_status text,
  post_published_at timestamptz,
  post_unpublish_at timestamptz
)
  returns boolean
  language sql
  stable
  set search_path = ''
as $$
  -- 003's public read policy, as a function.
  select coalesce(
    (post_status = 'published' or (post_status = 'scheduled' and post_published_at <= now()))
    and (post_unpublish_at is null or post_unpublish_at > now()),
    false)
$$;

grant execute on function public.blog_post_path(text) to anon, authenticated, service_role;
grant execute on function public.blog_post_is_live(text, timestamptz, timestamptz) to anon, authenticated, service_role;

create or replace function public.blog_posts_keep_old_address()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  cur public.blog_posts%rowtype;
  old_path text;
  new_path text;
  old_taken boolean;
  repointed integer := 0;
  switched_off integer := 0;
begin
  -- The row as the transaction leaves it: renamed twice in one transaction,
  -- both old addresses point at the final one; renamed back, nothing moved;
  -- deleted, nothing to point at.
  select * into cur from public.blog_posts where id = new.id;
  if not found or cur.slug = old.slug then
    return null;
  end if;

  if not public.blog_post_is_live(old.status, old.published_at, old.unpublish_at)
     or not public.blog_post_is_live(cur.status, cur.published_at, cur.unpublish_at) then
    return null;
  end if;

  old_path := public.blog_post_path(old.slug);
  new_path := public.blog_post_path(cur.slug);

  -- 3. Nothing may redirect away from the post's live address.
  update public.url_redirects
     set enabled = false,
         notes = concat_ws(E'\n', notes,
           'Switched off automatically: ' || new_path || ' is a live post again.')
   where source = new_path and enabled;
  get diagnostics switched_off = row_count;

  select exists (
    select 1 from public.blog_posts p
     where p.slug = old.slug
       and p.id <> cur.id
       and public.blog_post_is_live(p.status, p.published_at, p.unpublish_at)
  ) into old_taken;

  if not old_taken then
    -- 2. No chains: point what pointed at the old address at the new one.
    update public.url_redirects
       set destination = new_path
     where destination = old_path
       and not is_pattern
       and source <> new_path
       and source <> old_path;
    get diagnostics repointed = row_count;

    -- 1. The old address answers with a permanent redirect.
    insert into public.url_redirects
      (source, is_pattern, destination, permanent, enabled, category, notes, changed_by)
    values
      (old_path, false, new_path, true, true, 'post-slug-change',
       'Added automatically when the post moved to ' || new_path || '.', auth.uid())
    on conflict (source) do update
      set is_pattern = false,
          destination = excluded.destination,
          permanent = true,
          enabled = true,
          category = excluded.category,
          notes = concat_ws(E'\n', public.url_redirects.notes, excluded.notes),
          changed_by = excluded.changed_by;
  end if;

  insert into public.admin_audit_log (actor_user_id, actor_email, action, resource_type, resource_id, payload)
  values (
    auth.uid(), 'database', 'redirect.post_address_changed', 'blog_post', cur.id::text,
    jsonb_build_object(
      'from', old_path, 'to', new_path,
      'redirect_created', not old_taken,
      'repointed', repointed,
      'switched_off', switched_off));

  return null;
end;
$$;

revoke all on function public.blog_posts_keep_old_address() from public, anon, authenticated;

drop trigger if exists blog_posts_keep_old_address on public.blog_posts;
create constraint trigger blog_posts_keep_old_address
  after update on public.blog_posts
  deferrable initially deferred
  for each row
  when (old.slug is distinct from new.slug)
  execute function public.blog_posts_keep_old_address();
