-- Adds live tracking for 2hire's "trip_detected" generic signal (boolean) to
-- vehicle_signals, alongside online/position/distance_covered/
-- autonomy_percentage — same "own boolean + own *_updated_at column" shape
-- as vehicle_signals_add_locked.sql's own "locked" column, added for
-- BookingPage.tsx's hero-card car icon (green when a trip is currently
-- detected, see toVehicle2Hire's tripDetected mapping in
-- liveVehicleDataSource.ts and netlify/functions/2hire-webhook.mts's own
-- "trip_detected" case).
--
-- No subscription change needed: 2hire-subscribe.mts already subscribes to
-- the wildcard "vehicle:*:generic:*" topic (see _shared/twoHireClient.ts),
-- so trip_detected deliveries were already being recorded into
-- vehicle_signal_history — this migration just gives them a "current state"
-- column to land in too, same as any other newly-recognized generic signal.
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Safe to run more than once.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicle_signals' and column_name = 'trip_detected'
  ) then
    alter table public.vehicle_signals add column trip_detected boolean;
    alter table public.vehicle_signals add column trip_detected_updated_at timestamptz;
  end if;
end $$;
