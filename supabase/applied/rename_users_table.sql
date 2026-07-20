-- One-time migration: renames the "users" table to "user_profiles" (the
-- table itself was already renamed once before, from "profiles" to "users",
-- in rename_profiles_table.sql).
--
-- Guarded so it's safe to run regardless of whether the rename has already
-- happened. As with the profiles -> users rename, the helper functions and
-- trigger below reference "users" BY NAME inside their bodies, so a plain
-- table rename alone would leave them broken (every RLS-protected read/write
-- would start failing with "relation public.users does not exist" the
-- moment the table is renamed — this bit the app once already when the
-- profiles -> users rename was done via the dashboard before the matching
-- function fix ran). This migration renames the table AND fixes the
-- function bodies together, in one place.
--
-- Run this together with deploying the matching code change (every
-- .from("users") call in the app has been updated to .from("user_profiles")).
--
-- handle_auth_user_email_change() is now included below too — its actual
-- current source (retrieved via pg_get_functiondef) turned out to still
-- reference public.profiles/id, meaning it has been broken (silently,
-- since nobody had changed their email yet) ever since the FIRST rename
-- (profiles -> users), not just this one. Fixed here to point at
-- public.user_profiles/user_id, closing the gap for good.

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'users') then
    alter table public.users rename to user_profiles;
  end if;
end $$;

-- Helper functions used inside RLS policies (see rls_policies.sql, already
-- updated to reference public.user_profiles — re-run that file after this
-- one to pick up these same bodies, this is just the immediate fix).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_profiles
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
  select department from public.user_profiles where user_id = auth.uid();
$$;

create or replace function public.current_email()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select email from public.user_profiles where user_id = auth.uid();
$$;

-- Trigger fired on every new auth.users signup — inserts the matching
-- FLEETii user row (role/department hardcoded rather than trusted from
-- raw_user_meta_data, see security_advisor_fixes.sql for why).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.user_profiles (user_id, email, full_name, phone, department, role)
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

-- Syncs an auth.users email change into public.user_profiles. Was found to
-- still reference public.profiles/id (its pre-first-rename form) when its
-- source was pulled via pg_get_functiondef — fixed here alongside the
-- second rename.
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.email is distinct from old.email then
    update public.user_profiles set email = new.email where user_id = new.id;
  end if;
  return new;
end;
$function$;
