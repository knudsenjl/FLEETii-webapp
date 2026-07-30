-- Adds migrate_vehicle_to_2hire: the atomic PK swap needed to move a
-- vehicle_profiles row from its locally-generated placeholder vehicle_id
-- (seeded mock data — see seed_vehicle_profiles.sql) to 2hire's own real
-- vehicleId once it's actually registered with 2hire's test adaptor (see
-- netlify/functions/2hire-migrate-vehicle.mts).
--
-- vehicle_profiles.vehicle_id must become 2hire's real id (2hire's webhook
-- payloads and lock/unlock/locate commands address a vehicle by this exact
-- value — see rename_vehicle_id_to_uuid.sql), but four tables reference it
-- as a foreign key (vehicle_departments, bookings, vehicle_log,
-- vehicle_signals), and none of those FKs cascade on update (confirmed live
-- via pg_constraint — all four are NO ACTION), so a plain UPDATE of the PK
-- would fail outright. WB20499's own migration (register_2hire_test_vehicle.sql)
-- got away with a plain UPDATE only because it was a brand-new orphan row
-- with zero references at the time — that shortcut doesn't apply to a real,
-- in-use vehicle with real bookings/department assignments/signals.
--
-- Order matters: insert the new parent row FIRST (so every subsequent child
-- UPDATE always has a valid row to point at), THEN repoint every child,
-- THEN drop the now-orphaned old parent row.
--
-- vehicle_signals is UPDATEd, not dropped, so its "locked" flag (a real,
-- FLEETii-confirmed value from set-vehicle-lock.mts, not mock data) survives
-- the swap — the stale telemetry columns get overwritten once real signals
-- arrive (or once the caller pushes a snapshot to the new simulated device,
-- see 2hire-migrate-vehicle.mts).
--
-- SECURITY DEFINER, execute revoked from anon/authenticated — same trust
-- boundary as delete_vehicle/purge_costumer: no internal ownership check,
-- the caller is fully trusted since this is only reachable via the
-- service-role client from a requireFleetiiAdmin-gated function.
--
-- Safe to re-run: CREATE OR REPLACE / REVOKE are idempotent.

create or replace function public.migrate_vehicle_to_2hire(old_vehicle_id uuid, new_vehicle_id uuid, new_iot_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vehicle_profiles (vehicle_id, number_plate, iot_id, brand, model, model_year, costumer_id, department_id, created_at)
  select new_vehicle_id, number_plate, new_iot_id, brand, model, model_year, costumer_id, department_id, created_at
  from public.vehicle_profiles where vehicle_id = old_vehicle_id;

  update public.vehicle_departments set vehicle_id = new_vehicle_id where vehicle_id = old_vehicle_id;
  update public.bookings set vehicle_id = new_vehicle_id where vehicle_id = old_vehicle_id;
  update public.vehicle_log set vehicle_id = new_vehicle_id where vehicle_id = old_vehicle_id;
  update public.vehicle_signals set vehicle_id = new_vehicle_id where vehicle_id = old_vehicle_id;

  delete from public.vehicle_profiles where vehicle_id = old_vehicle_id;
end;
$$;

revoke all on function public.migrate_vehicle_to_2hire(uuid, uuid, text) from public;
revoke execute on function public.migrate_vehicle_to_2hire(uuid, uuid, text) from anon, authenticated;
