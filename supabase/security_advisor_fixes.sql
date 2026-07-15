-- Fixes for Supabase's Security Advisor warnings that are safe to apply
-- without seeing every function's source first.
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Safe to run more than once (guarded/idempotent throughout).

-- ---------------------------------------------------------------------------
-- PRIVILEGE ESCALATION FIX (most important change in this file):
-- handle_new_user()
--
-- Previously inserted the new profiles row using role/department taken
-- straight from raw_user_meta_data — which is exactly the field
-- supabase.auth.signUp()'s `options.data` lets ANY caller set directly, via
-- Supabase's public Auth REST API, independent of anything this app's own
-- frontend does. Since this trigger fires on every auth.users insert, not
-- just admin-driven invites, anyone able to reach the project (the anon key
-- is public by design) could previously self-register with
-- `data: { role: "admin" }` and be granted a real admin profiles row,
-- completely bypassing netlify/functions/create-user.mts's requireAdmin()
-- gate.
--
-- Fixed by hardcoding role to 'user' and department to null here — role/
-- department are only ever meant to be set by the trusted admin flow.
-- create-user.mts's own explicit upsert() (which runs right after inviting)
-- still sets the real role/department correctly afterward, since it
-- updates on conflict rather than doing nothing — so this doesn't change
-- legitimate admin-driven user creation at all. full_name/phone aren't
-- privilege-sensitive, so those still come from metadata.
--
-- Also double-check, in the Supabase dashboard (Authentication -> Providers
-- -> Email, or Authentication -> Settings), whether "Allow new users to
-- sign up" is enabled — if this app is never meant to support public
-- self-registration at all, disabling it there closes the door entirely
-- rather than just neutralizing the role/department it can be created with.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, full_name, phone, department, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    null,
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable: handle_new_user()
--
-- Same reasoning as handle_auth_user_email_change() below: RETURNS trigger
-- means Postgres already refuses to call it directly via a normal SQL/RPC
-- call, so revoking EXECUTE only closes an already-non-functional direct
-- route — it cannot affect trigger firing on a real signup/invite.
-- ---------------------------------------------------------------------------

revoke execute on function public.handle_new_user() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- function_search_path_mutable: touch_profiles_updated_at
--
-- A function with a mutable search_path is vulnerable to search_path
-- hijacking (a caller could get it to resolve an unqualified table/function
-- name to something else). Pinning it closes that off; doesn't require
-- knowing the function body.
-- ---------------------------------------------------------------------------

alter function public.touch_profiles_updated_at() set search_path = public;

-- ---------------------------------------------------------------------------
-- extension_in_public: btree_gist
--
-- Installed in `public` today (used by the booking-overlap exclusion
-- constraint). Moving it to a dedicated schema doesn't affect the
-- already-created constraint — Postgres resolves operator classes at
-- constraint-creation time, not per query.
-- ---------------------------------------------------------------------------

create schema if not exists extensions;

do $$
begin
  if not exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'btree_gist' and n.nspname = 'extensions'
  ) then
    alter extension btree_gist set schema extensions;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable: is_admin(),
-- current_department(), current_email()
--
-- These SECURITY DEFINER helpers exist purely to be called FROM WITHIN the
-- RLS policies in rls_policies.sql (e.g. `using (public.is_admin())`),
-- which run `to authenticated` — so `authenticated` must keep EXECUTE, or
-- every policy that calls them breaks and the app loses all DB access.
-- `anon` never needs them (no policy in this project applies `to anon`),
-- so revoking there closes the direct-RPC-call surface
-- (/rest/v1/rpc/is_admin etc.) without touching what the app relies on.
-- ---------------------------------------------------------------------------

revoke execute on function public.is_admin() from anon;
revoke execute on function public.current_department() from anon;
revoke execute on function public.current_email() from anon;

-- ---------------------------------------------------------------------------
-- anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable:
-- handle_auth_user_email_change()
--
-- Trigger function (RETURNS trigger) that syncs an auth.users email change
-- into public.profiles. Returns-trigger functions can only be invoked by
-- Postgres's own trigger mechanism — calling one directly via a normal
-- SQL/RPC call raises "trigger functions can only be called as triggers"
-- regardless of grants — and trigger firing itself isn't gated by the
-- DML-issuing role's EXECUTE grant on the function. So revoking from both
-- anon and authenticated only closes the (already-non-functional) direct
-- RPC route; it cannot affect the trigger syncing emails on a real auth
-- update.
-- ---------------------------------------------------------------------------

revoke execute on function public.handle_auth_user_email_change() from anon, authenticated;
