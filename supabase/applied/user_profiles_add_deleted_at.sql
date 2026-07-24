-- Turns "Slet bruger" into an archive (see netlify/functions/delete-user.mts)
-- rather than a real row delete. No table referencing user_profiles.user_id
-- has ON DELETE CASCADE (bookings, user_settings, user_departments) — a
-- plain UPDATE instead of a DELETE means none of those relationships ever
-- need touching at all, avoiding the FK-ordering problem entirely, and
-- (unlike a real delete) a departed employee's booking history keeps
-- resolving their name/email via the existing user_profiles(email) joins.
--
-- Also hardens the four SECURITY DEFINER helpers reused across nearly every
-- RLS policy in this schema (is_admin, is_fleetii_admin,
-- current_department_id, current_costumer_id) to stop recognizing an
-- archived user, as defense-in-depth beyond the auth-level ban (banning
-- blocks future logins/refreshes, but a JWT issued just before the ban may
-- still be valid — and thus still pass every RLS policy built on these
-- helpers — until it naturally expires).
--
-- Run in the Supabase SQL editor. Safe to run more than once.

alter table public.user_profiles add column if not exists deleted_at timestamptz;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid() and role = 'admin' and deleted_at is null
  );
$$;

create or replace function public.is_fleetii_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid() and role = 'FLEETii admin' and deleted_at is null
  );
$$;

create or replace function public.current_department_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select department_id from public.user_profiles
  where user_id = auth.uid() and deleted_at is null;
$$;

create or replace function public.current_costumer_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select costumer_id from public.user_profiles
  where user_id = auth.uid() and deleted_at is null;
$$;
