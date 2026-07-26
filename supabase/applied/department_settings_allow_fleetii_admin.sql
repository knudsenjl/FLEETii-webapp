-- Lets a "FLEETii admin" write department_settings for ANY department (no
-- department-match restriction, since they're platform-wide, not scoped to
-- one costumer/department) — needed so the new "Rettigheder for den nye
-- bruger" section on UserDetailsPage's "Ny bruger" create form actually
-- works when a FLEETii admin is the one creating the account, for whichever
-- Hjemmeafdeling they pick.
--
-- Narrow, targeted fix rather than widening is_admin() itself: is_admin()
-- inner-joins costumers via the caller's own costumer_id, and most policies
-- built on it (including this one, previously) also require
-- department_id = current_department_id() — both of which are null for a
-- FLEETii admin (no costumer/department of their own), so neither can ever
-- match for them regardless of role. A regular admin keeps the exact same
-- restriction as before (their own current department only); only the
-- FLEETii-admin branch is new, and it deliberately skips the department
-- match entirely.
--
-- Safe to re-run: policies dropped before recreated.

drop policy if exists "department_settings_insert_admin_own_department" on public.department_settings;
create policy "department_settings_insert_admin_own_department" on public.department_settings
  for insert
  to authenticated
  with check (
    public.is_fleetii_admin()
    or (public.is_admin() and department_id = public.current_department_id())
  );

drop policy if exists "department_settings_update_admin_own_department" on public.department_settings;
create policy "department_settings_update_admin_own_department" on public.department_settings
  for update
  to authenticated
  using (
    public.is_fleetii_admin()
    or (public.is_admin() and department_id = public.current_department_id())
  )
  with check (
    public.is_fleetii_admin()
    or (public.is_admin() and department_id = public.current_department_id())
  );
