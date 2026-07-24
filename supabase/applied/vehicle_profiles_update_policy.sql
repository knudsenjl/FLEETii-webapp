-- Lets an admin update a vehicle's own editable fields (number_plate,
-- brand, model, model_year — HandleVehiclePage.tsx's "Rediger køretøj"
-- form) — vehicle_profiles only had a SELECT policy until now
-- (vehicle_profiles_rls.sql). Scoped to the vehicle actually belonging to
-- one of the admin's own departments via vehicle_departments (the
-- many-to-many table added earlier this session), matching how
-- VehiclesPage/FleetManagementPage already only ever show an admin
-- vehicles in their own department in the first place.
--
-- Safe to re-run: GRANT is idempotent, policy is dropped before recreated.

grant update on public.vehicle_profiles to authenticated;

drop policy if exists "vehicle_profiles_update_admin_own_department" on public.vehicle_profiles;
create policy "vehicle_profiles_update_admin_own_department" on public.vehicle_profiles
  for update
  to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.vehicle_departments vd
      where vd.vehicle_id = vehicle_profiles.vehicle_id
        and vd.department_id = public.current_department_id()
    )
  )
  with check (
    public.is_admin()
    and exists (
      select 1 from public.vehicle_departments vd
      where vd.vehicle_id = vehicle_profiles.vehicle_id
        and vd.department_id = public.current_department_id()
    )
  );
