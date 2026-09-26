-- purge_costumer() must never delete a sysadm (code review 2026-09-26).
--
-- A sysadm has no home costumer: their user_profiles.costumer_id /
-- department_id are only the Data Filter scope pointer that
-- switch-department.mts sets (see CLAUDE.md, "Home department vs. active
-- department"). The previous version selected — and deleted — every
-- user_profiles row with costumer_id = the purged costumer, so a sysadm who
-- had that costumer picked in the Data Filter (likely while working on its
-- page) lost their own profile, and delete-costumer.mts then deleted their
-- auth account too.
--
-- Now, before anything is collected or deleted, every sysadm pointing at the
-- costumer or one of its departments is reset to "Alle" (costumer_id,
-- department_id and active_department_id all NULL — the same state login
-- resets them to), and sysadms are excluded from the affected users. Every
-- other step is unchanged from vehicle_signals_latest_rename_refs.sql.
-- delete-costumer.mts applies the same sysadm exclusion to the e-mail list
-- it logs to costumer_purge_log before calling this.
--
-- Run in the Supabase SQL editor (staging first). Safe to re-run.

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

  -- Sysadms only POINT at this costumer (Data Filter scope) — move them to
  -- "Alle" instead of deleting them, before any department they point at
  -- goes away.
  update public.user_profiles
  set costumer_id = null, department_id = null, active_department_id = null
  where role = 'sysadm'
    and (costumer_id = target_costumer_id
         or department_id = any(affected_department_ids)
         or active_department_id = any(affected_department_ids));

  select coalesce(array_agg(vehicle_id), array[]::uuid[]) into affected_vehicle_ids
  from public.vehicle_profiles where costumer_id = target_costumer_id;

  select coalesce(array_agg(user_id), array[]::uuid[]) into affected_user_ids
  from public.user_profiles where costumer_id = target_costumer_id and role <> 'sysadm';

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
  where user_id = any(affected_user_ids);

  delete from public.departments
  where costumer_id = target_costumer_id;

  delete from public.costumers
  where costumer_id = target_costumer_id;

  return query select unnest(affected_user_ids);
end;
$$;

revoke all on function public.purge_costumer(uuid) from public;
revoke execute on function public.purge_costumer(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification (rolled back — safe on staging): scope a sysadm at a throwaway
-- costumer, purge it, and check the sysadm survived with pointers reset.
--
--   begin;
--   insert into public.costumers (costumer_id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Purge test');
--   update public.user_profiles set costumer_id = '00000000-0000-0000-0000-0000000000f1'
--     where user_id = '<a sysadm user_id>';
--   select * from public.purge_costumer('00000000-0000-0000-0000-0000000000f1');  -- expect no rows
--   select role, costumer_id, department_id from public.user_profiles where user_id = '<same sysadm>';
--     -- expect: sysadm, null, null
--   rollback;
