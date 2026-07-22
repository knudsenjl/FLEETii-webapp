-- RLS policy for vehicle_departments — missed in vehicle_departments_table.sql.
-- Same gap, same symptom as vehicle_profiles_rls.sql/costumers_select_policy.sql
-- earlier this session: if this project defaults new tables to RLS-enabled
-- with zero policies, every read returns 200 with an empty array rather than
-- an error — exactly "fleet table shows no vehicles" even though the
-- backfill and joins are all correct.
--
-- Mirrors vehicle_profiles_rls.sql's permissive "any authenticated user may
-- read" policy — vehicle data isn't department-scoped at the RLS level
-- today (VehiclesPage/FleetManagementPage/AvailablePage filter by
-- department_id client-side via departmentIds instead).
--
-- Safe to run regardless of vehicle_departments' current RLS state.

alter table public.vehicle_departments enable row level security;

drop policy if exists "vehicle_departments_select_authenticated" on public.vehicle_departments;
create policy "vehicle_departments_select_authenticated"
  on public.vehicle_departments for select
  to authenticated
  using (true);
