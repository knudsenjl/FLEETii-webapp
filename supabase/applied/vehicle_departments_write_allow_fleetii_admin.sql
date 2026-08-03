-- Broadens vehicle_departments_insert_admin_own_costumer /
-- ..._delete_admin_own_costumer (vehicle_departments_write_policies.sql) so
-- a FLEETii admin can (un)assign a vehicle to/from ANY department, not just
-- one belonging to their own costumer — needed now that FLEETii admin
-- accounts are meant to operate unscoped, per the "let FLEETii admin operate
-- freely" work. Same "is_fleetii_admin(): unrestricted, is_admin(): own
-- costumer only" shape as departments_update_policy_allow_admin_own_costumer.sql.
--
-- Safe to re-run: policies are dropped before recreated.

drop policy if exists "vehicle_departments_insert_admin_own_costumer" on public.vehicle_departments;
create policy "vehicle_departments_insert_admin_own_costumer" on public.vehicle_departments
  for insert
  to authenticated
  with check (
    public.is_fleetii_admin()
    or (
      public.is_admin()
      and exists (
        select 1 from public.departments d
        where d.department_id = vehicle_departments.department_id
          and d.costumer_id = public.current_costumer_id()
      )
    )
  );

drop policy if exists "vehicle_departments_delete_admin_own_costumer" on public.vehicle_departments;
create policy "vehicle_departments_delete_admin_own_costumer" on public.vehicle_departments
  for delete
  to authenticated
  using (
    public.is_fleetii_admin()
    or (
      public.is_admin()
      and exists (
        select 1 from public.departments d
        where d.department_id = vehicle_departments.department_id
          and d.costumer_id = public.current_costumer_id()
      )
    )
  );
