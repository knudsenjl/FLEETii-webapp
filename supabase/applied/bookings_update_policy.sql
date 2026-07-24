-- Adds the missing UPDATE policy on bookings, needed for the new "Rediger
-- reservation" flow (BookingDetailsPage.tsx -> ReservationPage.tsx ->
-- AvailablePage.tsx -> ConfirmPage.tsx, editing an existing booking instead
-- of creating a new one). bookings previously only had SELECT/INSERT/
-- DELETE policies (see rls_policies.sql) — mirrors those two combined: a
-- user may update their own booking, or (if admin) any booking in their
-- own department; the row must still belong to their own department
-- afterward, and (unless admin) must still be assigned to themselves —
-- same shape as bookings_insert_own_department's with check.
--
-- Safe to re-run: policy is dropped before recreated.

drop policy if exists "bookings_update_own_or_department_admin" on public.bookings;
create policy "bookings_update_own_or_department_admin" on public.bookings
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or (public.is_admin() and department_id = public.current_department_id())
  )
  with check (
    department_id = public.current_department_id()
    and (public.is_admin() or user_id = auth.uid())
  );
