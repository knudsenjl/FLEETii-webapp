-- Lets a "FLEETii admin" rename departments directly from the browser
-- (DepartmentDetailsPage's new "Rediger afd. navne" -> EditDepartmentsPage
-- flow) — departments only had SELECT/INSERT/DELETE policies until now
-- (departments_select_policy.sql, departments_insert_delete_policy.sql).
-- Scoped to is_fleetii_admin(), same as the insert/delete policies.
--
-- Safe to re-run: GRANT is idempotent, policy is dropped before recreated.

grant update on public.departments to authenticated;

drop policy if exists "departments_update_fleetii_admin" on public.departments;
create policy "departments_update_fleetii_admin" on public.departments
  for update
  to authenticated
  using (public.is_fleetii_admin())
  with check (public.is_fleetii_admin());
