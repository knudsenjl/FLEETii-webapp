-- RLS policy for vehicle_profiles — never set up until now (this table was
-- only discovered mid-session via a foreign-key error from vehicle_signals,
-- not created as part of this project's own SQL files). If RLS is enabled
-- with no SELECT policy, every read returns 200 with an empty array rather
-- than an error — which is exactly the symptom that led here (fleet-table
-- empty in production, no console errors, 200 [] for the vehicle_profiles
-- request).
--
-- Mirrors vehicle_signals_select_authenticated's permissive "any
-- authenticated user may read" policy (see vehicle_signals_table.sql) —
-- vehicle data isn't department-scoped at the RLS level today (VehiclesPage
-- filters by department client-side via the departments column instead).
--
-- Safe to run regardless of vehicle_profiles' current RLS state.

alter table public.vehicle_profiles enable row level security;

drop policy if exists "vehicle_profiles_select_authenticated" on public.vehicle_profiles;
create policy "vehicle_profiles_select_authenticated"
  on public.vehicle_profiles for select
  to authenticated
  using (true);
