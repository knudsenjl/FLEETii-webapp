-- Fixes vehicle_signals.trip_detected, which has returned NULL for every
-- vehicle since vehicle_signals_to_narrow_schema.sql created this view
-- (2026-09-05): that migration's original SELECT read
-- signal_value->>'trip_detected', assuming this signal's JSON payload was
-- keyed by its own name like 'online'/'locked' are -- but 2hire's real
-- webhook payload for this one signal is actually {"value": true/false}
-- (confirmed 2026-09-11 against live production data via the Supabase MCP,
-- after a user report that VehicleDetailsPage's driving-vehicle icon never
-- showed even for a vehicle confirmed mid-trip), so the key never matched
-- and bool_or() always aggregated over NULLs -- the frontend then mapped
-- that NULL to "FALSE" (see liveVehicleDataSource.ts's toVehicle2Hire),
-- so the driving icon/Live-toggle default/health check's trip_detected
-- value have been silently wrong for every vehicle, for everyone, since
-- that migration -- not a caching or staleness issue at all.
--
-- Applied directly via the Supabase MCP to both Staging and Production on
-- 2026-09-11 (this file documents it after the fact, per this project's
-- "supabase/applied/ mirrors what's actually been run" convention -- see
-- CLAUDE.md/memory's "Production schema drift" note on promotions not
-- replaying these files automatically).
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query)
-- on any environment where it hasn't already been applied. Safe to run
-- more than once (CREATE OR REPLACE VIEW).

create or replace view public.vehicle_signals
with (security_invoker = true) as
select
  vsl.vehicle_id,
  bool_or((vsl.signal_value->>'online')::boolean) filter (where vsl.signal_type = 'online') as online,
  max(vsl.signal_timestamp) filter (where vsl.signal_type = 'online') as online_updated_at,
  max((vsl.signal_value->>'percentage')::numeric) filter (where vsl.signal_type = 'autonomy_percentage') as autonomy_percentage,
  max(vsl.signal_timestamp) filter (where vsl.signal_type = 'autonomy_percentage') as autonomy_percentage_updated_at,
  max((vsl.signal_value->>'meters')::numeric) filter (where vsl.signal_type = 'distance_covered') as distance_covered_meters,
  max(vsl.signal_timestamp) filter (where vsl.signal_type = 'distance_covered') as distance_covered_updated_at,
  max((vsl.signal_value->>'latitude')::double precision) filter (where vsl.signal_type = 'position') as lat,
  max((vsl.signal_value->>'longitude')::double precision) filter (where vsl.signal_type = 'position') as lng,
  max(vsl.signal_timestamp) filter (where vsl.signal_type = 'position') as position_updated_at,
  coalesce(bool_or((vsl.signal_value->>'locked')::boolean) filter (where vsl.signal_type = 'locked'), true) as locked,
  bool_or((vsl.signal_value->>'value')::boolean) filter (where vsl.signal_type = 'trip_detected') as trip_detected,
  max(vsl.signal_timestamp) filter (where vsl.signal_type = 'trip_detected') as trip_detected_updated_at
from public.vehicle_signals_latest vsl
group by vsl.vehicle_id;
