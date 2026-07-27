-- Lets a "FLEETii admin" SELECT user_profiles rows for ANY department (no
-- department-match restriction, since they're platform-wide, not scoped to
-- one costumer/department) — needed so the Department page's user list, and
-- the "Genetabler brugers adgang" unblock flow, actually work for a FLEETii
-- admin outside their own department. Same reasoning/pattern as
-- department_settings_allow_fleetii_admin.sql and
-- user_departments_allow_fleetii_admin.sql: is_admin() requires role =
-- 'admin' exactly, so a FLEETii admin never satisfied this policy at all,
-- regardless of whether their own profile happens to carry a
-- department_id (some do, for internal test accounts). A regular admin
-- keeps the exact same restriction as before (their own current department
-- only); only the FLEETii-admin branch is new.
--
-- Safe to re-run: policy dropped before recreated.

drop policy if exists "user_profiles_select_admin_own_department" on public.user_profiles;
create policy "user_profiles_select_admin_own_department" on public.user_profiles
  for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or (public.is_admin() and department_id = public.current_department_id())
  );
