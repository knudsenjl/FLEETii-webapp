-- ARCHIVED: already applied to the live database. Kept only as a historical
-- record of why vehicle_signals has a "locked" column — not needed to
-- reproduce the current schema (see vehicle_signals_table.sql for that).
--
-- Adds a "locked" flag to vehicle_signals for the Lås/Lås op buttons on
-- BookingDetailsPage/VehicleDetailsPage. This is a FLEETii-internal virtual
-- flag, NOT a real 2hire signal: 2hire's Signals API only exposes 5 generic
-- signals (online, position, distance_covered, autonomy_percentage,
-- autonomy_meters — see developer.2hire.io/docs/signals), none of which
-- report lock/door state. 2hire does define real start/stop commands that
-- functionally unlock/lock a vehicle, but wiring those up is deferred (they
-- can take up to 45s per 2hire's own docs, which needs a background-function
-- pattern this repo doesn't have yet) — this column is the interim
-- FLEETii-side record of the last Lock/Unlock button press, used by the
-- three button-activation rules (see src/lib/bookings.ts's
-- computeLockButtonState).
--
-- Lives on vehicle_signals (not vehicle_profiles) since it's live/mutable
-- per-vehicle state, matching everything else on this table. Defaults to
-- true (locked) so a vehicle with no prior button presses starts in the
-- expected physical state. Writes only ever happen via the service-role key
-- in netlify/functions/set-vehicle-lock.mts (see vehicle_signals_table.sql —
-- there is deliberately no client-side INSERT/UPDATE policy on this table).
--
-- Safe to run more than once.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicle_signals' and column_name = 'locked'
  ) then
    alter table public.vehicle_signals add column locked boolean not null default true;
  end if;
end $$;
