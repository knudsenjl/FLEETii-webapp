-- Extends public.delete_vehicle() (see vehicle_deletion_requests_table.sql,
-- called from delete-vehicle.mts via VehicleDeletePage.tsx's "Afregistrer
-- 2hire device og slet køretøjet" action) to also delete bookings,
-- vehicle_log, and vehicle_signal_history rows for the target vehicle.
--
-- The original function's own comment claimed "Deliberately does NOT touch
-- bookings — no FK forces it" — that was true when it was written, but all
-- three of bookings.vehicle_id, vehicle_log.vehicle_id, and
-- vehicle_signal_history.vehicle_id have since gained a real, enforced
-- foreign key to vehicle_profiles(vehicle_id) with ON DELETE NO ACTION
-- (confirmed live via information_schema.referential_constraints on both
-- Staging and Production, 2026-08-31), without the comment ever being
-- updated. That means the CURRENT function is actually broken for any
-- vehicle that has ever had a booking, a vehicle_log entry, or signal
-- history: deleting vehicle_profiles would hit a foreign-key violation and
-- the whole call would fail, leaving the vehicle stuck (deregistered from
-- 2hire — delete-vehicle.mts's own best-effort step already ran — but not
-- actually removable from FLEETii).
--
-- Per explicit product decision (2026-08-31): a deleted vehicle's full
-- history is meant to go with it — VehicleDeletePage.tsx's confirmation
-- dialog now says so plainly ("BEMÆRK, at dette også vil fjerne al historik
-- omkring dette køretøj") — so this isn't just a bug fix, it's the intended
-- behavior going forward. costumer_orders.vehicle_id is deliberately left
-- alone: it has no enforced FK (won't block this delete), the specific
-- order being fulfilled is already deleted separately by delete-vehicle.mts
-- itself, and it's an administrative request log rather than vehicle usage
-- history.
--
-- Safe to re-run: CREATE OR REPLACE FUNCTION.

create or replace function public.delete_vehicle(target_vehicle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.vehicle_departments where vehicle_id = target_vehicle_id;
  delete from public.vehicle_signals where vehicle_id = target_vehicle_id;
  delete from public.vehicle_signal_history where vehicle_id = target_vehicle_id;
  delete from public.vehicle_log where vehicle_id = target_vehicle_id;
  delete from public.bookings where vehicle_id = target_vehicle_id;
  delete from public.vehicle_profiles where vehicle_id = target_vehicle_id;
end;
$$;

revoke all on function public.delete_vehicle(uuid) from public;
revoke execute on function public.delete_vehicle(uuid) from anon, authenticated;
