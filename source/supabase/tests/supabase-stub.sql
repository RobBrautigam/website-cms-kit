-- The parts of a Supabase project the migrations rely on, rebuilt for an
-- in-memory Postgres (PGlite) so the tests run with no project and no network:
-- the API roles, Supabase's default grants, auth.uid() and auth.jwt() reading
-- the request's JWT claims, auth.users and auth.mfa_factors, and the two
-- Storage tables. Tests only; never run this on a real project.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- Supabase grants every new object in public to the three API roles by
-- default. The migrations have to take back what they do not want exposed,
-- so the tests start from the same default.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null
);

create function auth.jwt() returns jsonb
  language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create function auth.uid() returns uuid
  language sql stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);

alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
