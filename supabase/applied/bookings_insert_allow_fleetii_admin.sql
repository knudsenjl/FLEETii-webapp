-- Broadens bookings_insert_own_department (rls_policies.sql) so a FLEETii
-- admin can create a brand-new booking for ANY department, not just their
-- own current_department_id() — needed now that ReservationPage.tsx has a
-- genuine "Kunde/afdeling" picker for a FLEETii admin (they have no
-- department of their own to satisfy the old check with at all, see the
-- "let FLEETii admin operate unscoped" work). This was deliberately left
-- unwidened during that work's Phase 0 (only bookings UPDATE/DELETE got the
-- is_fleetii_admin() branch) since no booking-creation department-picker
-- existed yet anywhere in the app — it does now, so this closes the gap.
--
-- Same "is_fleetii_admin(): unrestricted, is_admin(): own department only"
-- shape as departments_update_policy_allow_admin_own_costumer.sql.
--
-- Safe to re-run: policy is dropped before recreated.

drop policy if exists "bookings_insert_own_department" on public.bookings;
create policy "bookings_insert_own_department" on public.bookings
  for insert
  to authenticated
  with check (
    public.is_fleetii_admin()
    or (
      department_id = public.current_department_id()
      and (public.is_admin() or user_id = auth.uid())
    )
  );
