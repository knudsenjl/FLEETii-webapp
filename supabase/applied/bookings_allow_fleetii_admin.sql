-- Broadens bookings_update_own_or_department_admin (bookings_update_policy.sql)
-- and bookings_delete_own_or_department_admin (rls_policies.sql) so a
-- FLEETii admin can update/delete ANY booking, not just one in their own
-- department — needed now that FLEETii admin accounts are meant to operate
-- unscoped, per the "let FLEETii admin operate freely" work. Same
-- "is_fleetii_admin(): unrestricted, is_admin(): own department only" shape
-- as departments_update_policy_allow_admin_own_costumer.sql.
--
-- bookings_insert_own_department is deliberately left untouched: creating a
-- brand-new booking still requires a target department (no department-picker
-- exists anywhere in the booking-creation flow), same accepted gap as
-- ConfirmPage.tsx's existing !afdelingId guard.
--
-- Safe to re-run: policies are dropped before recreated.

drop policy if exists "bookings_update_own_or_department_admin" on public.bookings;
create policy "bookings_update_own_or_department_admin" on public.bookings
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_fleetii_admin()
    or (public.is_admin() and department_id = public.current_department_id())
  )
  with check (
    public.is_fleetii_admin()
    or (
      department_id = public.current_department_id()
      and (public.is_admin() or user_id = auth.uid())
    )
  );

drop policy if exists "bookings_delete_own_or_department_admin" on public.bookings;
create policy "bookings_delete_own_or_department_admin" on public.bookings
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_fleetii_admin()
    or (public.is_admin() and department_id = public.current_department_id())
  );
