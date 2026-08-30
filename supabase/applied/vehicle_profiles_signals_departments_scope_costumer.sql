-- Scopes vehicle_profiles/vehicle_signals/vehicle_departments SELECT to the
-- caller's own costumer (tenant isolation) -- these three tables' original
-- policies (vehicle_profiles_rls.sql/vehicle_signals_table.sql/
-- vehicle_departments_rls.sql) all shipped as `using (true)` for any
-- authenticated user, with an explicit comment that department/costumer
-- scoping was left to client-side filtering (VehiclesPage/
-- FleetManagementPage) instead of RLS. That means any authenticated user of
-- ANY costumer could read every OTHER costumer's entire fleet (brand,
-- model, nummerplade) and live GPS position/telemetry via a direct
-- Supabase REST call, bypassing the UI filters entirely -- a cross-tenant
-- data leak on a platform whose whole premise is per-costumer fleets.
--
-- Fixed the same way every other cross-costumer policy in this schema
-- already works (see e.g. costumer_orders_table.sql,
-- vehicle_deletion_requests_table.sql): public.is_fleetii_admin()
-- (platform-wide, unscoped) or an exact costumer_id match via
-- public.current_costumer_id() -- both SECURITY DEFINER helpers already
-- defined (rls_policies.sql / costumers_insert_policy.sql).
-- Deliberately costumer-level, not department-level: like
-- bookings_select_authenticated, department-level narrowing stays a
-- client-side concern (VehiclesPage/FleetManagementPage already do this) --
-- only the CUSTOMER boundary is an actual tenant-isolation requirement.
--
-- vehicle_signals/vehicle_departments have no costumer_id column of their
-- own, so their policies join to vehicle_profiles.costumer_id by
-- vehicle_id -- vehicle_profiles.costumer_id is populated at insert time
-- for every vehicle registered through the app (see
-- netlify/functions/2hire-register-vehicle.mts) and was backfilled for
-- every pre-existing row (see
-- add_vehicle_profiles_costumer_and_department_fk.sql), so this join isn't
-- expected to silently exclude any real vehicle.
--
-- Applied to FLEETii-DB-Staging on 2026-08-30. Safe to re-run: policies
-- dropped before recreated.

drop policy if exists "vehicle_profiles_select_authenticated" on public.vehicle_profiles;
create policy "vehicle_profiles_select_authenticated"
  on public.vehicle_profiles for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or costumer_id = public.current_costumer_id()
  );

drop policy if exists "vehicle_signals_select_authenticated" on public.vehicle_signals;
create policy "vehicle_signals_select_authenticated"
  on public.vehicle_signals for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or exists (
      select 1 from public.vehicle_profiles vp
      where vp.vehicle_id = vehicle_signals.vehicle_id
        and vp.costumer_id = public.current_costumer_id()
    )
  );

drop policy if exists "vehicle_departments_select_authenticated" on public.vehicle_departments;
create policy "vehicle_departments_select_authenticated"
  on public.vehicle_departments for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or exists (
      select 1 from public.vehicle_profiles vp
      where vp.vehicle_id = vehicle_departments.vehicle_id
        and vp.costumer_id = public.current_costumer_id()
    )
  );
