-- Guarantees every vehicle is, by definition, always a member of its
-- costumer's "Alle køretøjer" department (department_id) — not just
-- whatever specific department(s) it was explicitly assigned to. Two parts,
-- mirroring backfill_and_seed_default_anvendelse.sql's shape:
--
-- 1. One-time backfill: for every EXISTING vehicle_departments row, also
--    inserts a row pairing that same vehicle with its costumer's own
--    "Alle køretøjer" department (found via the department it's already
--    assigned to -> that department's costumer_id -> that costumer's
--    "Alle køretøjer" row). Vehicles with no department assignment at all
--    yet have nothing to infer a costumer from, so nothing to backfill for
--    them (there are none today — every real vehicle already has at least
--    one vehicle_departments row from the original backfill/admin
--    assignment).
--
-- 2. From now on, a trigger on vehicle_departments itself fires on every
--    new row and inserts the matching "Alle køretøjer" pairing too — this
--    covers HandleVehiclePage.tsx's checkbox table (assigning a vehicle to
--    ANY department now also guarantees Alle køretøjer) and any future/
--    external process that assigns a vehicle to a department directly. The
--    `alle_id <> new.department_id` guard stops the trigger's own insert
--    (of the Alle køretøjer row) from recursively re-triggering itself.
--
-- SECURITY DEFINER (same pattern as create_default_department_for_costumer/
-- seed_default_anvendelse_for_department) so this works regardless of the
-- inserting admin's own vehicle_departments RLS.
--
-- Safe to re-run: backfill's ON CONFLICT DO NOTHING is idempotent, function
-- is CREATE OR REPLACE, trigger dropped before recreated.

-- 1. Backfill.
insert into public.vehicle_departments (vehicle_id, department_id)
select distinct vd.vehicle_id, alle.department_id
from public.vehicle_departments vd
join public.departments d on d.department_id = vd.department_id
join public.departments alle on alle.costumer_id = d.costumer_id and alle.name = 'Alle køretøjer'
on conflict (vehicle_id, department_id) do nothing;

-- 2. Trigger for future vehicle_departments rows.
create or replace function public.assign_vehicle_to_alle_koretojer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  alle_id uuid;
begin
  select alle.department_id into alle_id
  from public.departments d
  join public.departments alle on alle.costumer_id = d.costumer_id and alle.name = 'Alle køretøjer'
  where d.department_id = new.department_id;

  if alle_id is not null and alle_id <> new.department_id then
    insert into public.vehicle_departments (vehicle_id, department_id)
    values (new.vehicle_id, alle_id)
    on conflict (vehicle_id, department_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists vehicle_departments_assign_alle_koretojer on public.vehicle_departments;
create trigger vehicle_departments_assign_alle_koretojer
  after insert on public.vehicle_departments
  for each row
  execute function public.assign_vehicle_to_alle_koretojer();
