-- Repoints migrate_vehicle_to_2hire()/delete_vehicle()/purge_costumer() at
-- vehicle_signals_latest (see vehicle_signals_to_narrow_schema.sql) now
-- that public.vehicle_signals is a VIEW, not a table these can write
-- through. Nothing about what these three functions DO changes -- they
-- update/delete rows in the real underlying "current state" table exactly
-- as before, just under its new name. migrate_vehicle_to_2hire's UPDATE now
-- repoints however-many rows exist for that vehicle across signal types
-- (previously always exactly one row) -- same functional intent ("this
-- vehicle's current-state rows now belong to the new id").
--
-- Run this in the Supabase SQL editor. Safe to re-run: CREATE OR REPLACE
-- FUNCTION / REVOKE are idempotent.

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
  update public.vehicle_signals_latest set vehicle_id = new_vehicle_id where vehicle_id = old_vehicle_id;

  delete from public.vehicle_profiles where vehicle_id = old_vehicle_id;
end;
$$;

revoke all on function public.migrate_vehicle_to_2hire(uuid, uuid, text) from public;
revoke execute on function public.migrate_vehicle_to_2hire(uuid, uuid, text) from anon, authenticated;


create or replace function public.delete_vehicle(target_vehicle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.vehicle_departments where vehicle_id = target_vehicle_id;
  delete from public.vehicle_signals_latest where vehicle_id = target_vehicle_id;
  delete from public.vehicle_signal_history where vehicle_id = target_vehicle_id;
  delete from public.vehicle_log where vehicle_id = target_vehicle_id;
  delete from public.bookings where vehicle_id = target_vehicle_id;
  delete from public.vehicle_profiles where vehicle_id = target_vehicle_id;
end;
$$;

revoke all on function public.delete_vehicle(uuid) from public;
revoke execute on function public.delete_vehicle(uuid) from anon, authenticated;


create or replace function public.purge_costumer(target_costumer_id uuid)
returns table (purged_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_department_ids uuid[];
  affected_vehicle_ids uuid[];
  affected_user_ids uuid[];
begin
  select coalesce(array_agg(department_id), array[]::uuid[]) into affected_department_ids
  from public.departments where costumer_id = target_costumer_id;

  select coalesce(array_agg(vehicle_id), array[]::uuid[]) into affected_vehicle_ids
  from public.vehicle_profiles where costumer_id = target_costumer_id;

  select coalesce(array_agg(user_id), array[]::uuid[]) into affected_user_ids
  from public.user_profiles where costumer_id = target_costumer_id;

  delete from public.bookings
  where department_id = any(affected_department_ids)
     or user_id = any(affected_user_ids)
     or vehicle_id = any(affected_vehicle_ids);

  delete from public.vehicle_signals_latest
  where vehicle_id = any(affected_vehicle_ids);

  delete from public.vehicle_departments
  where vehicle_id = any(affected_vehicle_ids)
     or department_id = any(affected_department_ids);

  delete from public.vehicle_profiles
  where costumer_id = target_costumer_id;

  delete from public.user_departments
  where user_id = any(affected_user_ids)
     or department_id = any(affected_department_ids);

  delete from public.user_settings
  where user_id = any(affected_user_ids);

  delete from public.department_settings
  where department_id = any(affected_department_ids);

  delete from public.user_profiles
  where costumer_id = target_costumer_id;

  delete from public.departments
  where costumer_id = target_costumer_id;

  delete from public.costumers
  where costumer_id = target_costumer_id;

  return query select unnest(affected_user_ids);
end;
$$;

revoke all on function public.purge_costumer(uuid) from public;
revoke execute on function public.purge_costumer(uuid) from anon, authenticated;
