-- Lets a "FLEETii admin" create/delete departments directly from the
-- browser (CostumerDetailsPage's new departments table + "Ny afdeling"/
-- "Slet afdeling" buttons) — departments only had a SELECT policy until
-- now (departments_select_policy.sql). Scoped to is_fleetii_admin() (see
-- costumers_insert_policy.sql), matching this whole feature's route
-- gating — plain "admin" has no department create/delete path anywhere
-- in the app today.
--
-- No ON DELETE CASCADE exists from any table referencing
-- departments.department_id (bookings, settings, user_profiles,
-- user_departments, vehicle_departments all use plain FKs) — deleting a
-- department that still has any of those will fail with a
-- foreign-key-violation error surfaced as-is, same as costumers'
-- delete policy's reasoning.
--
-- Safe to re-run: GRANT is idempotent, policies are dropped before
-- recreated.

grant insert, delete on public.departments to authenticated;

drop policy if exists "departments_insert_fleetii_admin" on public.departments;
create policy "departments_insert_fleetii_admin" on public.departments
  for insert
  to authenticated
  with check (public.is_fleetii_admin());

drop policy if exists "departments_delete_fleetii_admin" on public.departments;
create policy "departments_delete_fleetii_admin" on public.departments
  for delete
  to authenticated
  using (public.is_fleetii_admin());
