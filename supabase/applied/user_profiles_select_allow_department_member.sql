-- Fixes a real bug: AllBookingsPage (and anywhere else that embeds
-- user_profiles(email, user_ident) via a booking's user_id FK) showed "--"
-- for a booking's user whenever that user's HOME department
-- (user_profiles.department_id) differed from the viewing admin's own
-- department -- even though the user has a legitimate active booking in the
-- admin's department via a user_departments membership (cross-department
-- booking access). bookings itself has no department restriction
-- (bookings_select_authenticated: qual = true), so the booking row was
-- always visible; only the embedded profile join was silently blocked by
-- user_profiles' own SELECT RLS, since that policy only checked the user's
-- HOME department_id, never user_departments membership. Confirmed live:
-- user@alpha.dk's home department is "Region SYD" but they have 3 active
-- bookings on "Region NORD" vehicles via a user_departments row for Region
-- NORD -- Region NORD's own admin couldn't see their email/user_ident.
--
-- Adds a third branch mirroring user_departments_select_own_or_admin_costumer's
-- own "is a member via the bridge table" pattern: an admin can now also see
-- a user_profiles row when that user has a user_departments membership in
-- the admin's own current department, not just when it's their home
-- department.
--
-- Safe to re-run: policy dropped before recreated.

drop policy if exists "user_profiles_select_admin_own_department" on public.user_profiles;
create policy "user_profiles_select_admin_own_department" on public.user_profiles
  for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or (public.is_admin() and department_id = public.current_department_id())
    or (
      public.is_admin()
      and exists (
        select 1
        from public.user_departments ud
        where ud.user_id = user_profiles.user_id
          and ud.department_id = public.current_department_id()
      )
    )
  );
