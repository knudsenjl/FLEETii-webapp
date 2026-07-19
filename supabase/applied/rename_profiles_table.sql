-- ARCHIVED — DO NOT RE-RUN: this table was renamed a SECOND time after this
-- file ("users" -> "user_profiles", see rename_users_table.sql, which is
-- NOT archived and stays live). The is_admin()/current_department()/
-- current_email()/handle_new_user() bodies below still point at
-- "public.users", which no longer exists — re-running this file would
-- overwrite those functions with these stale, broken bodies and take down
-- every RLS-protected read/write in the app. Kept only as a historical
-- record of the first rename step; rls_policies.sql and
-- rename_users_table.sql are the current, correct source for these
-- functions.
--
-- One-time migration: renames the "profiles" table to "users", and its "id"
-- column to "user_id". Safe to run regardless of whether the table/column
-- rename has already been done manually (e.g. via Supabase's Table Editor
-- UI) — the table/column renames below are guarded to no-op if already
-- applied, and the function bodies always use create-or-replace.
--
-- "users" here is FLEETii's OWN user-record table (name/phone/department/
-- role), keyed by user_id = auth.users.id — a different table, in the public
-- schema, from Supabase's own auth.users (a different schema entirely).
-- This is a common Supabase pattern and doesn't collide with anything, but
-- always schema-qualify (public.users vs auth.users) when writing new SQL
-- against this project so the two are never confused.
--
-- RLS policies, indexes, and foreign keys are attached to the table/column
-- themselves and survive a rename automatically. The functions below
-- reference "profiles"/"id" BY NAME inside their bodies, so renaming the
-- table/column alone leaves them broken — every RLS-protected read against
-- this table calls is_admin()/current_department() as part of evaluating its
-- policy, so as soon as the table/column is renamed, EVERY such read starts
-- failing with "relation public.profiles does not exist" (this is exactly
-- what happened when the table was renamed via the dashboard before this
-- file was run — the fix below is what closes that gap).
--
-- IMPORTANT — NOT covered by this file: handle_auth_user_email_change() also
-- reads/writes public.profiles.id inside its body and is ALSO broken right
-- now if the table has already been renamed live. Its current source was
-- never captured in a checked-in file. Run:
--   select pg_get_functiondef('public.handle_auth_user_email_change()'::regprocedure);
-- and paste the result back so its create-or-replace (pointed at
-- public.users.user_id) can be added here — this needs fixing urgently,
-- not just before some future migration.

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'profiles') then
    alter table public.profiles rename to users;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'id'
  ) then
    alter table public.users rename column id to user_id;
  end if;
end $$;

-- Helper functions used inside RLS policies (see rls_policies.sql, already
-- updated to reference public.users.user_id — re-run that file after this
-- one to pick up these same bodies, this is just the immediate fix).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.users
    where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_department()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select department from public.users where user_id = auth.uid();
$$;

create or replace function public.current_email()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select email from public.users where user_id = auth.uid();
$$;

-- Trigger fired on every new auth.users signup — inserts the matching
-- FLEETii user row (role/department hardcoded rather than trusted from
-- raw_user_meta_data, see security_advisor_fixes.sql for why). new.id here
-- is auth.users.id (the signed-up account, a different table) — unaffected
-- by this rename, it's just the value being inserted into users.user_id.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.users (user_id, email, full_name, phone, department, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    null,
    'user'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$function$;

-- Pure rename, no body change needed (renaming a function doesn't affect
-- the trigger using it — Postgres tracks that link by OID, not by name).
-- Guarded (ALTER FUNCTION has no IF EXISTS clause in Postgres) so this is
-- safe to re-run even after it's already been renamed.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'touch_profiles_updated_at'
  ) then
    alter function public.touch_profiles_updated_at() rename to touch_users_updated_at;
  end if;
end $$;
