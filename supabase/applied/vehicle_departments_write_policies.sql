-- Adds INSERT/DELETE to vehicle_departments (see
-- supabase/applied/vehicle_departments_table.sql/vehicle_departments_rls.sql,
-- which only ever added a SELECT policy) — needed for HandleVehiclePage.tsx's
-- new "Afdeling(er)" checkbox table, the first place in the app that lets an
-- admin actually manage which departments a vehicle belongs to (previously
-- only readable, populated by a one-time backfill).
--
-- Scoped by the DEPARTMENT being (un)assigned, not the vehicle's own current
-- department_ids — checking "vehicle already in one of the admin's
-- departments" would wrongly block assigning a vehicle's very FIRST
-- department (a vehicle can have zero vehicle_departments rows, e.g. right
-- after creation). An admin may add/remove any row whose department_id
-- belongs to their own costumer, matching UserDetailsPage.tsx's own
-- department-picker scoping (current_costumer_id()).
--
-- Safe to re-run: GRANT is idempotent, policies dropped before recreated.

grant insert, delete on public.vehicle_departments to authenticated;

drop policy if exists "vehicle_departments_insert_admin_own_costumer" on public.vehicle_departments;
create policy "vehicle_departments_insert_admin_own_costumer" on public.vehicle_departments
  for insert
  to authenticated
  with check (
    public.is_admin()
    and exists (
      select 1 from public.departments d
      where d.department_id = vehicle_departments.department_id
        and d.costumer_id = public.current_costumer_id()
    )
  );

drop policy if exists "vehicle_departments_delete_admin_own_costumer" on public.vehicle_departments;
create policy "vehicle_departments_delete_admin_own_costumer" on public.vehicle_departments
  for delete
  to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.departments d
      where d.department_id = vehicle_departments.department_id
        and d.costumer_id = public.current_costumer_id()
    )
  );
