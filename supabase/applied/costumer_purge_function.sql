-- Adds the "Slet kunde" full data purge (see CostumerDetailsPage.tsx,
-- FLEETii-admin only, delete-costumer.mts) — the final, IRREVERSIBLE step
-- in the costumer lifecycle, after "Deaktiver kunde"
-- (costumers_add_deactivated_at.sql). Deletes every trace of a costumer:
-- bookings, vehicles, settings, department/user grants, user profiles,
-- departments, and the costumer row itself. Auth accounts (auth.users) are
-- NOT touched here — delete-costumer.mts deletes those afterward, using the
-- purged_user_id rows this function returns (the only chance to learn them,
-- since user_profiles is gone by the time this function returns).
--
-- No ON DELETE CASCADE exists anywhere in this schema, so deletes happen in
-- explicit dependency order (leaves first): bookings -> vehicle_signals ->
-- vehicle_departments -> vehicle_profiles -> user_departments ->
-- user_settings -> department_settings -> user_profiles -> departments ->
-- costumers.
--
-- SECURITY DEFINER + execute revoked from anon/authenticated: only ever
-- callable via the service-role client, from a FLEETii-admin-gated Netlify
-- Function (delete-costumer.mts) that has ALREADY checked the costumer is
-- deactivated and that the caller typed its name to confirm — this function
-- itself does not re-check either precondition, by design (it's not
-- reachable from the browser at all).
--
-- costumer_purge_log: a cheap recovery trail. delete-costumer.mts inserts
-- one row here (costumer_id, costumer_name, the affected users' emails)
-- BEFORE calling this function, so the emails/user_ids stay recoverable
-- even if the auth-account deletion loop fails partway through afterward.
-- RLS enabled with zero policies — refused for every role except the
-- service-role client, which bypasses RLS entirely; nothing in the browser
-- should ever read this table.
--
-- Run in the Supabase SQL editor. Safe to run more than once.

create table if not exists public.costumer_purge_log (
  costumer_purge_log_id uuid not null default gen_random_uuid() primary key,
  costumer_id uuid not null,
  costumer_name text,
  user_emails text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.costumer_purge_log enable row level security;

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

  delete from public.vehicle_signals
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
