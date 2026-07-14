-- Live 2hire vehicle signals (online, GPS position, distance covered,
-- autonomy percentage), one row per vehicle_id.
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- It is safe to run more than once (CREATE TABLE IF NOT EXISTS, policies are
-- dropped before being recreated).
--
-- Context: netlify/functions/2hire-webhook.mts is the only writer, using the
-- service-role key (bypasses RLS) after validating 2hire's webhook
-- signature — so, like "profiles" in rls_policies.sql, there is deliberately
-- no INSERT/UPDATE policy here. Any authenticated FLEETii user may read the
-- table (src/lib/vehicleDataSource/liveVehicleDataSource.ts queries it
-- directly from the browser), since today's mock 2hire data is equally
-- unrestricted.
--
-- Each signal has its own *_updated_at column (rather than one row-level
-- updated_at) because 2hire delivers one signal at a time per webhook call —
-- an "online" update must not overwrite a "position" update's freshness, and
-- vice versa.

create table if not exists public.vehicle_signals (
  vehicle_id text primary key,
  online boolean,
  online_updated_at timestamptz,
  autonomy_percentage numeric,
  autonomy_percentage_updated_at timestamptz,
  distance_covered_meters numeric,
  distance_covered_updated_at timestamptz,
  lat double precision,
  lng double precision,
  position_updated_at timestamptz
);

alter table public.vehicle_signals enable row level security;

drop policy if exists "vehicle_signals_select_authenticated" on public.vehicle_signals;
create policy "vehicle_signals_select_authenticated"
  on public.vehicle_signals for select
  to authenticated
  using (true);
