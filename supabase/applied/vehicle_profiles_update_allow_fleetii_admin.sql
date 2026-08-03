-- Broadens vehicle_profiles_update_admin_own_department
-- (vehicle_profiles_update_policy.sql) so a FLEETii admin can update ANY
-- vehicle, not just one in their own department — needed now that FLEETii
-- admin accounts are meant to operate unscoped (no home department/costumer)
-- per the "let FLEETii admin operate freely" work. Same
-- "is_fleetii_admin(): unrestricted, is_admin(): own department only" shape
-- as departments_update_policy_allow_admin_own_costumer.sql. Without this,
-- HandleVehiclePage.tsx's save silently no-ops (0 rows) for a FLEETii admin
-- editing a vehicle outside their (former) home department.
--
-- Safe to re-run: policy is dropped before recreated.

drop policy if exists "vehicle_profiles_update_admin_own_department" on public.vehicle_profiles;
create policy "vehicle_profiles_update_admin_own_department" on public.vehicle_profiles
  for update
  to authenticated
  using (
    public.is_fleetii_admin()
    or (
      public.is_admin()
      and exists (
        select 1 from public.vehicle_departments vd
        where vd.vehicle_id = vehicle_profiles.vehicle_id
          and vd.department_id = public.current_department_id()
      )
    )
  )
  with check (
    public.is_fleetii_admin()
    or (
      public.is_admin()
      and exists (
        select 1 from public.vehicle_departments vd
        where vd.vehicle_id = vehicle_profiles.vehicle_id
          and vd.department_id = public.current_department_id()
      )
    )
  );
