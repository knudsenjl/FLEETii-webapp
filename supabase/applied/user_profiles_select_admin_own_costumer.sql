-- Widens a regular admin's SELECT access on user_profiles from "their own
-- current department (or a cross-department user_departments grant into
-- it)" to "anyone within their own costumer" — needed for DepartmentPage's
-- own new UNLOCKED mode (2026-08-28: BRUGERE from AdminFrontpage/
-- CostumerDetailsPage now shows the whole costumer, filterable by
-- Afdeling, matching what its own count badge already promised), which
-- this RLS policy was silently undermining: the client-side query asked
-- for the whole costumer, but RLS only ever actually returned rows for the
-- admin's own currently-active department regardless (confirmed live: an
-- admin whose active department is "Region NORD" saw ONLY Region NORD
-- users even though "Region SYD" users clearly existed under the same
-- costumer).
--
-- A FLEETii admin is unaffected (is_fleetii_admin() already grants
-- everything, unconditionally, first in the OR chain). vehicle_profiles/
-- vehicle_departments needed no equivalent fix — both already have a
-- blanket "true" SELECT policy (department scoping there is client-side
-- only, per vehicle_departments_table.sql's own header), so KØRETØJER's own
-- identical UNLOCKED mode was never actually blocked by RLS the way
-- BRUGERE's was.
--
-- The old "own department" and "cross-department user_departments grant"
-- branches are dropped, not just widened alongside — both are strict
-- subsets of "same costumer" (a department belongs to exactly one
-- costumer, and this app never grants a user_departments membership into a
-- department outside their own costumer), so keeping them would have been
-- redundant.
--
-- Safe to re-run: policy dropped before recreated.

drop policy if exists "user_profiles_select_admin_own_department" on public.user_profiles;
create policy "user_profiles_select_admin_own_department" on public.user_profiles
  for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or (public.is_admin() and costumer_id = public.current_costumer_id())
  );
