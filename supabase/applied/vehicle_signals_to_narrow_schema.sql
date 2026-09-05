-- Converts vehicle_signals from ONE ROW PER VEHICLE (a fixed pair of
-- columns per known 2hire signal type) into a NARROW table named
-- vehicle_signals_latest -- one row per (vehicle_id, signal_type), same
-- shape as its sibling vehicle_signal_history (signal_type text,
-- signal_value jsonb, signal_timestamp timestamptz -- see that table's own
-- doc comment in vehicle_signal_history_table.sql for why EAV was already
-- chosen there). This brings the "current state" table in line so a
-- brand-new future 2hire signal type needs zero schema/code changes to get
-- live "current state" tracking -- previously every new signal needed its
-- own ALTER TABLE ... add column + add column ..._updated_at (see
-- vehicle_signals_add_trip_detected.sql / vehicle_signals_add_locked.sql).
--
-- A compatibility VIEW named vehicle_signals is created at the end of this
-- migration, pivoting vehicle_signals_latest back into EXACTLY today's wide
-- shape/column names/types -- every existing reader
-- (src/lib/vehicleDataSource/liveVehicleDataSource.ts,
-- src/hooks/useVehicleLockState.ts, src/pages/VehiclesPage.tsx,
-- src/pages/AllBookingsPage.tsx, netlify/functions/set-vehicle-lock.mts's
-- own read, netlify/functions/2hire-vehicle-command.mts) keeps working with
-- ZERO code changes. Only the writers change (see
-- upsert_vehicle_signal_if_newer_generic.sql and
-- netlify/functions/set-vehicle-lock.mts's write path).
--
-- WITH (security_invoker = true) (Postgres 15+, confirmed running on
-- Postgres 17.6 here) is not optional polish -- it is the ONLY thing that
-- makes the view enforce the QUERYING user's own RLS against
-- vehicle_signals_latest. Without it, a view historically runs with the
-- privileges/policy exemptions of its OWNER (whichever role runs this
-- migration, typically "postgres") -- since RLS policies are evaluated
-- against the effective querying role, an owner-privileged view would
-- silently let EVERY authenticated user read EVERY costumer's live
-- telemetry through the view, regardless of the real RLS policy on the
-- underlying table. security_invoker = true closes that gap by making the
-- view transparent: the same costumer-scoped SELECT policy that protected
-- the old wide table (vehicle_profiles_signals_departments_scope_costumer.sql)
-- keeps protecting every read through this view, unchanged. Views cannot
-- have their own RLS enabled (RLS only applies to tables) -- there is
-- deliberately no "alter view ... enable row level security" below; that
-- would error.
--
-- "locked" is the one column here that isn't a real 2hire signal at all --
-- see vehicle_signals_add_locked.sql's original doc comment -- but is
-- folded into the same generic (vehicle_id, signal_type, signal_value,
-- signal_timestamp) shape as signal_type = 'locked', written by
-- netlify/functions/set-vehicle-lock.mts through the same
-- upsert_vehicle_signal_if_newer() RPC every real signal uses. The view
-- defaults a vehicle with no 'locked' row yet to true (matching the old
-- column's `not null default true`) via coalesce(...).
--
-- THIS MIGRATION IS NOT SAFE TO RE-RUN after it succeeds once -- it drops
-- the source wide table (public.vehicle_signals) as one of its own steps,
-- so a second run would fail outright (table no longer exists to backfill
-- from). It IS safe to retry after a FAILED run: everything below is one
-- transaction, so any error rolls back the entire thing, leaving the
-- database exactly as it was before this ran.
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query)
-- on Staging first. See this plan's own verification section for the exact
-- before/after checks to run before touching Production.

begin;

-- STEP 1: create the new narrow "current state" table + its own RLS.
create table public.vehicle_signals_latest (
  vehicle_id uuid not null references public.vehicle_profiles(vehicle_id),
  signal_type text not null,
  signal_value jsonb not null,
  signal_timestamp timestamptz not null,
  primary key (vehicle_id, signal_type)
);

alter table public.vehicle_signals_latest enable row level security;

create policy "vehicle_signals_latest_select_authenticated"
  on public.vehicle_signals_latest for select
  to authenticated
  using (
    is_sysadm()
    or exists (
      select 1 from public.vehicle_profiles vp
      where vp.vehicle_id = vehicle_signals_latest.vehicle_id
        and vp.costumer_id = current_costumer_id()
    )
  );

-- STEP 2: backfill from the current wide table -- one row per
-- (vehicle_id, signal_type) for every signal that has a non-null value,
-- using each one's own *_updated_at column as signal_timestamp. "locked"
-- has no *_updated_at column today (it's a plain flag, never a timestamped
-- 2hire signal) -- backfilled with now() at migration time, since there is
-- no historical record of when it was actually last set.
insert into public.vehicle_signals_latest (vehicle_id, signal_type, signal_value, signal_timestamp)
select vehicle_id, 'online', jsonb_build_object('online', online), online_updated_at
from public.vehicle_signals
where online is not null and online_updated_at is not null
union all
select vehicle_id, 'position', jsonb_build_object('latitude', lat, 'longitude', lng), position_updated_at
from public.vehicle_signals
where lat is not null and lng is not null and position_updated_at is not null
union all
select vehicle_id, 'distance_covered', jsonb_build_object('meters', distance_covered_meters), distance_covered_updated_at
from public.vehicle_signals
where distance_covered_meters is not null and distance_covered_updated_at is not null
union all
select vehicle_id, 'autonomy_percentage', jsonb_build_object('percentage', autonomy_percentage), autonomy_percentage_updated_at
from public.vehicle_signals
where autonomy_percentage is not null and autonomy_percentage_updated_at is not null
union all
select vehicle_id, 'trip_detected', jsonb_build_object('trip_detected', trip_detected), trip_detected_updated_at
from public.vehicle_signals
where trip_detected is not null and trip_detected_updated_at is not null
union all
select vehicle_id, 'locked', jsonb_build_object('locked', locked), now()
from public.vehicle_signals
where locked is not null;

-- STEP 3: drop the old wide table now that every row has been unpacked.
drop table public.vehicle_signals;

-- STEP 4: compatibility view -- pivots vehicle_signals_latest back into
-- EXACTLY the old wide shape/column names/types. Every aggregate here is
-- over at most one matching row per vehicle_id (guaranteed by
-- vehicle_signals_latest's composite primary key), so bool_or()/max() just
-- pass that single value through, or NULL if that signal_type has no row
-- yet for this vehicle -- identical semantics to the old nullable columns.
create view public.vehicle_signals
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
  bool_or((vsl.signal_value->>'trip_detected')::boolean) filter (where vsl.signal_type = 'trip_detected') as trip_detected,
  max(vsl.signal_timestamp) filter (where vsl.signal_type = 'trip_detected') as trip_detected_updated_at
from public.vehicle_signals_latest vsl
group by vsl.vehicle_id;

commit;
