-- Row Level Security policies for FLEETii's "user_profiles" and "bookings" tables.
--
-- "user_profiles" is FLEETii's own user-record table (name/phone/department/
-- role), keyed by user_id = auth.users.id — NOT the same table as
-- Supabase's own auth.users, which lives in a different schema and is
-- untouched by any of this. Was named "profiles" (with a plain "id" column)
-- until supabase/rename_profiles_table.sql, then "users" until
-- supabase/rename_users_table.sql.
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- It is safe to run more than once (helper functions use CREATE OR REPLACE,
-- policies are dropped before being recreated).
--
-- Context: the app's anon key is public (shipped in the browser bundle), so
-- it cannot be used as the security boundary. These policies restrict what
-- an *authenticated Supabase user* may do, based on their own user_profiles row
-- (role/department) — matching how the app's role/afdeling model already
-- works client-side, but now enforced server-side too.

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read `user_profiles`
-- without recursing into the very policies that use them).
-- ---------------------------------------------------------------------------

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

-- bookings.department_id (uuid, see bookings_department_to_department_id.sql)
-- has no direct counterpart on user_profiles, which still stores the
-- department as a plain text name — so this resolves the caller's own
-- department name to its departments.department_id via a join, rather than
-- requiring user_profiles to also carry a department_id column.
create or replace function public.current_department_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select d.department_id
  from public.user_profiles u
  join public.departments d on d.name = u.department
  where u.user_id = auth.uid();
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

-- ---------------------------------------------------------------------------
-- user_profiles
--
-- App usage today: every logged-in user reads their own row (AuthContext).
-- Admin-only pages (DepartmentPage, AllBookingsPage's filter) read across
-- their own department's users. Only DepartmentPage deletes a user row
-- (admin only). User creation goes exclusively through the create-user
-- Netlify function using the service-role key, which bypasses RLS entirely
-- — so there is deliberately no INSERT/UPDATE policy here.
--
-- Note: UserDetailsPage's live "email already taken" check also reads
-- `user_profiles` by email, but only ever sees same-department matches now
-- (an admin can no longer see other departments' rows at all, see below) —
-- a cross-department duplicate is still caught, just later, when
-- create-user's createUser() call hits Supabase Auth's own global
-- email-uniqueness constraint and returns a real error. Not a
-- data-integrity gap, just a slightly less proactive UX check.
-- ---------------------------------------------------------------------------

alter table public.user_profiles enable row level security;

drop policy if exists "profiles_select_own" on public.user_profiles;
drop policy if exists "users_select_own" on public.user_profiles;
drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own" on public.user_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Admins may only read users within their own department, mirroring the
-- department-scoped list DepartmentPage actually shows them (this used to
-- be `using (public.is_admin())` with no department check at all, letting
-- any admin read every user's row — name/phone/email/role — company wide
-- via a direct API call; tightened to match the sibling delete policy
-- below).
drop policy if exists "profiles_select_admin_all" on public.user_profiles;
drop policy if exists "profiles_select_admin_own_department" on public.user_profiles;
drop policy if exists "users_select_admin_own_department" on public.user_profiles;
drop policy if exists "user_profiles_select_admin_own_department" on public.user_profiles;
create policy "user_profiles_select_admin_own_department" on public.user_profiles
  for select
  to authenticated
  using (public.is_admin() and department = public.current_department());

-- Admins may only delete users within their own department, mirroring the
-- department-scoped list DepartmentPage actually shows them.
drop policy if exists "profiles_delete_admin_own_department" on public.user_profiles;
drop policy if exists "users_delete_admin_own_department" on public.user_profiles;
drop policy if exists "user_profiles_delete_admin_own_department" on public.user_profiles;
create policy "user_profiles_delete_admin_own_department" on public.user_profiles
  for delete
  to authenticated
  using (public.is_admin() and department = public.current_department());

-- ---------------------------------------------------------------------------
-- bookings
--
-- App usage today: AvailablePage reads ALL bookings' vehicle/time windows
-- (across every department) to compute vehicle availability — this is a
-- genuine cross-department read, not a bug. Non-admins query their own
-- bookings via .eq("user", email); admins query broadly and filter by
-- department client-side. ConfirmPage inserts a booking; admins may book on
-- behalf of another user in their own department, non-admins only for
-- themselves. Deletes happen from BookingDetailsPage/BookingsPage (a user
-- cancelling their own booking) and AllBookingsPage (admin, any booking they
-- can see). There is no client-side UPDATE anywhere.
--
-- bookings.department_id is a uuid (see
-- bookings_department_to_department_id.sql) — compared via
-- current_department_id(), NOT current_department() (that one's for
-- user_profiles.department, still a text name).
-- ---------------------------------------------------------------------------

alter table public.bookings enable row level security;

-- Left open to any authenticated user (not just the row's owner) because the
-- availability check genuinely needs to see other users'/departments'
-- booking windows. If you want to lock this down further later, move the
-- availability check into a SECURITY DEFINER RPC that returns only
-- free/busy — then this policy can be tightened to "own rows only".
drop policy if exists "bookings_select_authenticated" on public.bookings;
create policy "bookings_select_authenticated" on public.bookings
  for select
  to authenticated
  using (true);

-- A booking's department must match the creator's own department. A
-- non-admin may only book for themselves; an admin may book on behalf of
-- anyone (still constrained to their own department).
drop policy if exists "bookings_insert_own_department" on public.bookings;
create policy "bookings_insert_own_department" on public.bookings
  for insert
  to authenticated
  with check (
    department_id = public.current_department_id()
    and (public.is_admin() or "user" = public.current_email())
  );

-- A user may delete their own booking; an admin may delete any booking
-- within their own department.
drop policy if exists "bookings_delete_own_or_department_admin" on public.bookings;
create policy "bookings_delete_own_or_department_admin" on public.bookings
  for delete
  to authenticated
  using (
    "user" = public.current_email()
    or (public.is_admin() and department_id = public.current_department_id())
  );
