-- Adds public.upsert_vehicle_signal_if_newer(), a guarded replacement for
-- 2hire-webhook.mts's previous plain `.upsert()` into vehicle_signals.
--
-- The plain upsert had no ordering guard: if two webhook deliveries for the
-- same vehicle+signal (e.g. two "position" updates, arriving out of order
-- because of a network retry or just delivery jitter) were processed
-- concurrently, whichever one's UPDATE committed LAST won — even if its own
-- payload timestamp was actually OLDER than the one it overwrote. Postgres's
-- row-level lock keeps the two UPDATEs from corrupting each other, but
-- neither the app code nor a plain upsert ever checked which payload was
-- actually newer, so a stale delivery could silently clobber a fresher one
-- already in vehicle_signals (vehicle_signal_history, the append-only log,
-- would still have both rows — only the "current state" row was at risk).
--
-- Investigated 2026-09-05 after a report of DS81080's map position looking
-- stale. That specific incident turned out to be a missing delivery (2hire
-- never sent it, or we never received it at all — confirmed via
-- vehicle_signal_history having no corresponding row whatsoever), not this
-- race. Auditing the whole table for this race specifically — comparing
-- vehicle_signals against the MAX signal_timestamp actually recorded per
-- vehicle in vehicle_signal_history — found zero cases of it having
-- happened so far. This migration closes the class of bug pre-emptively
-- rather than waiting for it to actually bite.
--
-- One CASE branch per currently-recognized generic signal (mirrors
-- 2hire-webhook.mts's now-removed toColumnUpdate() switch — this function
-- is the new single source of truth for that mapping). An unrecognized
-- signal name falls through to the ELSE branch and does nothing here — it's
-- still recorded into vehicle_signal_history by the caller regardless
-- (unconditionally, before this function is ever invoked — see that
-- function's own header comment), so nothing is lost, there's just no
-- "current state" column for it yet.
--
-- Each branch's own *_updated_at column is the ONLY ordering guard — e.g. a
-- "position" update is only ever compared against the row's own
-- position_updated_at, never online_updated_at or any other signal's
-- column, since 2hire delivers one signal at a time and different signals'
-- freshness is independent (see vehicle_signals_table.sql's own comment on
-- why there's one *_updated_at column per signal rather than a single
-- row-level one).
--
-- coalesce(..., false) on the two boolean signals preserves
-- toColumnUpdate()'s old Boolean(undefined)-is-false default for a missing
-- payload field; the numeric/timestamp casts return NULL for a missing
-- field (same as before — Number(undefined) is NaN, which JSON.stringify
-- silently turns into null in transit) but now raise a real error for a
-- genuinely malformed value instead of silently coercing it to NaN->null —
-- an intentional, minor tightening, not a behavior this function tries to
-- preserve.
--
-- Returns whether it actually applied the update (false for an
-- unrecognized signal, or for a recognized one whose own guard rejected it
-- as stale) — 2hire-webhook.mts uses this to also skip its live Realtime
-- position broadcast for a rejected "position" delivery, so a stale/
-- out-of-order update can't flash the map to a wrong position even
-- momentarily on its way to being correctly discarded here.
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Safe to re-run: CREATE OR REPLACE FUNCTION.

create or replace function public.upsert_vehicle_signal_if_newer(
  p_vehicle_id uuid,
  p_signal text,
  p_timestamp timestamptz,
  p_data jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied boolean := false;
  v_row_count integer;
begin
  case p_signal
    when 'online' then
      insert into vehicle_signals (vehicle_id, online, online_updated_at)
      values (p_vehicle_id, coalesce((p_data->>'online')::boolean, false), p_timestamp)
      on conflict (vehicle_id) do update
        set online = excluded.online,
            online_updated_at = excluded.online_updated_at
        where vehicle_signals.online_updated_at is null
           or excluded.online_updated_at > vehicle_signals.online_updated_at;
      get diagnostics v_row_count = row_count;
      v_applied := v_row_count > 0;

    when 'position' then
      insert into vehicle_signals (vehicle_id, lat, lng, position_updated_at)
      values (
        p_vehicle_id,
        (p_data->>'latitude')::double precision,
        (p_data->>'longitude')::double precision,
        p_timestamp
      )
      on conflict (vehicle_id) do update
        set lat = excluded.lat,
            lng = excluded.lng,
            position_updated_at = excluded.position_updated_at
        where vehicle_signals.position_updated_at is null
           or excluded.position_updated_at > vehicle_signals.position_updated_at;
      get diagnostics v_row_count = row_count;
      v_applied := v_row_count > 0;

    when 'distance_covered' then
      insert into vehicle_signals (vehicle_id, distance_covered_meters, distance_covered_updated_at)
      values (p_vehicle_id, (p_data->>'meters')::numeric, p_timestamp)
      on conflict (vehicle_id) do update
        set distance_covered_meters = excluded.distance_covered_meters,
            distance_covered_updated_at = excluded.distance_covered_updated_at
        where vehicle_signals.distance_covered_updated_at is null
           or excluded.distance_covered_updated_at > vehicle_signals.distance_covered_updated_at;
      get diagnostics v_row_count = row_count;
      v_applied := v_row_count > 0;

    when 'autonomy_percentage' then
      insert into vehicle_signals (vehicle_id, autonomy_percentage, autonomy_percentage_updated_at)
      values (p_vehicle_id, (p_data->>'percentage')::numeric, p_timestamp)
      on conflict (vehicle_id) do update
        set autonomy_percentage = excluded.autonomy_percentage,
            autonomy_percentage_updated_at = excluded.autonomy_percentage_updated_at
        where vehicle_signals.autonomy_percentage_updated_at is null
           or excluded.autonomy_percentage_updated_at > vehicle_signals.autonomy_percentage_updated_at;
      get diagnostics v_row_count = row_count;
      v_applied := v_row_count > 0;

    when 'trip_detected' then
      insert into vehicle_signals (vehicle_id, trip_detected, trip_detected_updated_at)
      values (p_vehicle_id, coalesce((p_data->>'trip_detected')::boolean, false), p_timestamp)
      on conflict (vehicle_id) do update
        set trip_detected = excluded.trip_detected,
            trip_detected_updated_at = excluded.trip_detected_updated_at
        where vehicle_signals.trip_detected_updated_at is null
           or excluded.trip_detected_updated_at > vehicle_signals.trip_detected_updated_at;
      get diagnostics v_row_count = row_count;
      v_applied := v_row_count > 0;

    else
      -- Unrecognized generic signal: nothing to do here — see this
      -- function's own header comment. v_applied stays false.
      null;
  end case;

  return v_applied;
end;
$$;

revoke all on function public.upsert_vehicle_signal_if_newer(uuid, text, timestamptz, jsonb) from public;
revoke execute on function public.upsert_vehicle_signal_if_newer(uuid, text, timestamptz, jsonb) from anon, authenticated;
