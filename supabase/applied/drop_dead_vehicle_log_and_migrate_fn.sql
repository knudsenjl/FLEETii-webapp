-- Dead database objects found by the 2026-09-26 code review. Neither has
-- been used by the app since the 2hire test-migration tooling was removed
-- (2026-08-03, see 2hire-migrate-vehicle.mts/2hire-resync-vehicle.mts's
-- removal):
--
--   * public.migrate_vehicle_to_2hire(uuid, uuid, text) — the bulk
--     test-vehicle migration's SQL half; no caller left anywhere.
--   * public.vehicle_log — an early per-vehicle event table. Empty on both
--     staging and production (checked 2026-09-26), no app code reads or
--     writes it; its only remaining reference was a cleanup DELETE inside
--     delete_vehicle(), removed below.
--
-- delete_vehicle() is redefined exactly as it was (verified identical on
-- staging and production, md5 983c29eabd8b4c81e41f66f0747d50e5) minus the
-- vehicle_log line. vehicle_log is only dropped if it's still empty, so
-- this refuses to destroy data if anything started writing to it.
--
-- Run in the Supabase SQL editor (staging first). Safe to re-run.

drop function if exists public.migrate_vehicle_to_2hire(uuid, uuid, text);

create or replace function public.delete_vehicle(target_vehicle_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.vehicle_departments where vehicle_id = target_vehicle_id;
  delete from public.vehicle_signals_latest where vehicle_id = target_vehicle_id;
  delete from public.vehicle_signal_history where vehicle_id = target_vehicle_id;
  delete from public.bookings where vehicle_id = target_vehicle_id;
  delete from public.vehicle_profiles where vehicle_id = target_vehicle_id;
end;
$function$;

revoke all on function public.delete_vehicle(uuid) from public;
revoke execute on function public.delete_vehicle(uuid) from anon, authenticated;

do $$
begin
  if to_regclass('public.vehicle_log') is null then
    return;
  end if;
  if exists (select 1 from public.vehicle_log) then
    raise exception 'vehicle_log is not empty — refusing to drop it; check what writes to it first.';
  end if;
  drop table public.vehicle_log;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verification:
--   select to_regclass('public.vehicle_log');                                   -- null
--   select to_regprocedure('public.migrate_vehicle_to_2hire(uuid,uuid,text)');   -- null
--   select has_function_privilege('authenticated', 'public.delete_vehicle(uuid)', 'execute'); -- false
