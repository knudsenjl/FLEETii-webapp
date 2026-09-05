-- Collapses upsert_vehicle_signal_if_newer()'s five per-signal CASE
-- branches (see the now-superseded vehicle_signals_upsert_if_newer_function.sql)
-- into ONE generic branch, now that vehicle_signals_latest
-- (vehicle_signals_to_narrow_schema.sql) has one row per (vehicle_id,
-- signal_type) instead of one fixed column pair per known signal. A
-- brand-new 2hire signal type this codebase has never seen before now
-- gets "current state" tracking automatically -- no migration, no code
-- change needed -- unlike before, where an unrecognized signal fell to the
-- old function's ELSE branch and got no current-state row at all (it was
-- still recorded into vehicle_signal_history regardless, so nothing was
-- ever actually lost -- see that table's own doc comment).
--
-- signal_timestamp is NOT NULL on vehicle_signals_latest, so there is no
-- "is null" fallback branch here the way the old per-column function needed
-- one: the FIRST-EVER write for a given (vehicle_id, signal_type) pair has
-- no existing row to conflict with at all, so it is a plain INSERT, not
-- subject to the ON CONFLICT ... WHERE guard below in any way -- that guard
-- only ever runs for a genuinely SECOND-OR-LATER write to the same pair.
-- RETURNING true INTO a plpgsql variable leaves it NULL whenever zero rows
-- were affected (either this was a stale/older delivery the WHERE guard
-- rejected, or an exact-timestamp tie -- both preserved as "not applied",
-- same strict `>` semantics the old function used), and the final
-- coalesce(..., false) turns that NULL into a real false return.
--
-- Returns whether it actually applied the update -- same contract as
-- before, unrecognized signals now included -- so
-- netlify/functions/2hire-webhook.mts's own signalApplied gating (only
-- broadcasts a "position" Realtime update when actually applied) keeps
-- working completely unchanged; it only ever inspects the boolean, never
-- which case branch produced it. Signature (parameter names/types, return
-- type) is byte-for-byte identical to the function this replaces, so
-- 2hire-webhook.mts needs no code change at all.
--
-- Run this in the Supabase SQL editor. Safe to re-run: CREATE OR REPLACE
-- FUNCTION.

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
  v_applied boolean;
begin
  insert into public.vehicle_signals_latest (vehicle_id, signal_type, signal_value, signal_timestamp)
  values (p_vehicle_id, p_signal, p_data, p_timestamp)
  on conflict (vehicle_id, signal_type) do update
    set signal_value = excluded.signal_value,
        signal_timestamp = excluded.signal_timestamp
    where excluded.signal_timestamp > vehicle_signals_latest.signal_timestamp
  returning true into v_applied;

  return coalesce(v_applied, false);
end;
$$;

revoke all on function public.upsert_vehicle_signal_if_newer(uuid, text, timestamptz, jsonb) from public;
revoke execute on function public.upsert_vehicle_signal_if_newer(uuid, text, timestamptz, jsonb) from anon, authenticated;
