-- Row Level Security policies for FLEETii's "profiles" and "Bookings" tables.
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- It is safe to run more than once (helper functions use CREATE OR REPLACE,
-- policies are dropped before being recreated).
--
-- Context: the app's anon key is public (shipped in the browser bundle), so
-- it cannot be used as the security boundary. These policies restrict what
-- an *authenticated Supabase user* may do, based on their own profiles row
-- (role/department) — matching how the app's role/afdeling model already
-- works client-side, but now enforced server-side too.

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read `profiles` without
-- recursing into the very policies that use them).
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_department()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select department from public.profiles where id = auth.uid();
$$;

create or replace function public.current_email()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select email from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- profiles
--
-- App usage today: every logged-in user reads their own row (AuthContext).
-- Admin-only pages (DepartmentPage, AllBookingsPage's filter) read across
-- their own department's profiles. Only DepartmentPage deletes a profile
-- (admin only). Profile creation goes exclusively through the create-user
-- Netlify function using the service-role key, which bypasses RLS entirely
-- — so there is deliberately no INSERT/UPDATE policy here.
--
-- Note: UserDetailsPage's live "email already taken" check also reads
-- `profiles` by email, but only ever sees same-department matches now (an
-- admin can no longer see other departments' rows at all, see below) — a
-- cross-department duplicate is still caught, just later, when create-user's
-- inviteUserByEmail() call hits Supabase Auth's own global email-uniqueness
-- constraint and returns a real error. Not a data-integrity gap, just a
-- slightly less proactive UX check.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- Admins may only read profiles within their own department, mirroring the
-- department-scoped list DepartmentPage actually shows them (this used to
-- be `using (public.is_admin())` with no department check at all, letting
-- any admin read every user's profile — name/phone/email/role — company
-- wide via a direct API call; tightened to match the sibling delete policy
-- below).
drop policy if exists "profiles_select_admin_all" on public.profiles;
create policy "profiles_select_admin_own_department" on public.profiles
  for select
  to authenticated
  using (public.is_admin() and department = public.current_department());

-- Admins may only delete users within their own department, mirroring the
-- department-scoped list DepartmentPage actually shows them.
drop policy if exists "profiles_delete_admin_own_department" on public.profiles;
create policy "profiles_delete_admin_own_department" on public.profiles
  for delete
  to authenticated
  using (public.is_admin() and department = public.current_department());

-- ---------------------------------------------------------------------------
-- "Bookings"  (capitalized table name — quote it exactly like this)
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
-- ---------------------------------------------------------------------------

alter table public."Bookings" enable row level security;

-- Left open to any authenticated user (not just the row's owner) because the
-- availability check genuinely needs to see other users'/departments'
-- booking windows. If you want to lock this down further later, move the
-- availability check into a SECURITY DEFINER RPC that returns only
-- free/busy — then this policy can be tightened to "own rows only".
drop policy if exists "bookings_select_authenticated" on public."Bookings";
create policy "bookings_select_authenticated" on public."Bookings"
  for select
  to authenticated
  using (true);

-- A booking's department must match the creator's own department. A
-- non-admin may only book for themselves; an admin may book on behalf of
-- anyone (still constrained to their own department).
drop policy if exists "bookings_insert_own_department" on public."Bookings";
create policy "bookings_insert_own_department" on public."Bookings"
  for insert
  to authenticated
  with check (
    department = public.current_department()
    and (public.is_admin() or "user" = public.current_email())
  );

-- A user may delete their own booking; an admin may delete any booking
-- within their own department.
drop policy if exists "bookings_delete_own_or_department_admin" on public."Bookings";
create policy "bookings_delete_own_or_department_admin" on public."Bookings"
  for delete
  to authenticated
  using (
    "user" = public.current_email()
    or (public.is_admin() and department = public.current_department())
  );
