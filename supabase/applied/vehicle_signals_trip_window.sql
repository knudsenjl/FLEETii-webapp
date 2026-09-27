-- Adds three columns to the vehicle_signals view for the trip-aware vehicle
-- health rule (src/lib/vehicleHealth.ts, 2026-09-27), which replaced the
-- fixed "every signal older than 3 days is unhealthy" rule — that one flagged
-- every idle car, since Kilometerstand/Drivmiddelniveau only arrive while a
-- car is driven:
--
--   last_trip_start_at  first trip_detected=true after the last false before
--                       the latest true, i.e. when the latest trip began
--   last_trip_end_at    first trip_detected=false after that latest true;
--                       null while the trip is still running
--   online_false_since  first online=false after the latest online=true;
--                       null while the vehicle is online. Online flickers to
--                       false for ~10 s many times a day (production,
--                       2026-09-27), so the rule only treats it as an error
--                       after 15 minutes — which needs this "since", not just
--                       the latest value.
--
-- All three come from vehicle_signal_history, which has RLS with no select
-- policy (clients can't read it). vehicle_trip_window() is therefore SECURITY
-- DEFINER and repeats vehicle_signals_latest's own select policy itself
-- (sysadm, or the vehicle belongs to the caller's costumer); any other
-- vehicle gets nulls. Every lookup is an ORDER BY … LIMIT 1 on the unique
-- index (vehicle_id, signal_type, signal_timestamp).
--
-- Run in the Supabase SQL editor on each environment. Safe to run more than
-- once (CREATE OR REPLACE; the view only appends columns at the end).

create or replace function public.vehicle_trip_window(p_vehicle_id uuid)
returns table (last_trip_start_at timestamptz, last_trip_end_at timestamptz, online_false_since timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select 1
    where is_sysadm()
       or exists (
         select 1 from vehicle_profiles vp
         where vp.vehicle_id = p_vehicle_id and vp.costumer_id = current_costumer_id()
       )
  ),
  trip as (
    select
      (select h.signal_timestamp from vehicle_signal_history h
        where h.vehicle_id = p_vehicle_id and h.signal_type = 'trip_detected'
          and (h.signal_value->>'value')::boolean
        order by h.signal_timestamp desc limit 1) as last_true
  ),
  trip_prev_false as (
    select
      trip.last_true,
      (select h.signal_timestamp from vehicle_signal_history h
        where h.vehicle_id = p_vehicle_id and h.signal_type = 'trip_detected'
          and not (h.signal_value->>'value')::boolean
          and h.signal_timestamp < trip.last_true
        order by h.signal_timestamp desc limit 1) as prev_false
    from trip
  ),
  online_last_true as (
    select
      (select h.signal_timestamp from vehicle_signal_history h
        where h.vehicle_id = p_vehicle_id and h.signal_type = 'online'
          and (h.signal_value->>'online')::boolean
        order by h.signal_timestamp desc limit 1) as last_true
  )
  select
    -- No trip_detected=true on record: no trip, so no window.
    case when t.last_true is null then null else
      (select h.signal_timestamp from vehicle_signal_history h
        where h.vehicle_id = p_vehicle_id and h.signal_type = 'trip_detected'
          and (h.signal_value->>'value')::boolean
          and h.signal_timestamp > coalesce(t.prev_false, '-infinity'::timestamptz)
        order by h.signal_timestamp asc limit 1)
    end,
    case when t.last_true is null then null else
      (select h.signal_timestamp from vehicle_signal_history h
        where h.vehicle_id = p_vehicle_id and h.signal_type = 'trip_detected'
          and not (h.signal_value->>'value')::boolean
          and h.signal_timestamp > t.last_true
        order by h.signal_timestamp asc limit 1)
    end,
    (select h.signal_timestamp from vehicle_signal_history h
      where h.vehicle_id = p_vehicle_id and h.signal_type = 'online'
        and not (h.signal_value->>'online')::boolean
        and h.signal_timestamp > coalesce(o.last_true, '-infinity'::timestamptz)
      order by h.signal_timestamp asc limit 1)
  from trip_prev_false t, online_last_true o, allowed
$$;

revoke all on function public.vehicle_trip_window(uuid) from public, anon;
grant execute on function public.vehicle_trip_window(uuid) to authenticated, service_role;

create or replace view public.vehicle_signals
with (security_invoker = true) as
select s.*, w.last_trip_start_at, w.last_trip_end_at, w.online_false_since
from (
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
  group by vsl.vehicle_id
) s
left join lateral public.vehicle_trip_window(s.vehicle_id) w on true;
