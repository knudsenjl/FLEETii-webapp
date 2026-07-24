-- Guarantees every department's "Anvendelse" list (department_settings)
-- always includes "Andet (angiv årsag)" — the free-text fallback
-- ReservationPage.tsx treats specially (see ANDET_VALUE in
-- src/lib/settings.ts). Two parts:
--
-- 1. One-time backfill: inserts a fresh Anvendelse row (just
--    ["Andet (angiv årsag)"]) for any department that has none at all, and
--    appends the value to any existing row that's missing it.
--
-- 2. From now on, a trigger on departments itself (not on costumers —
--    covers BOTH the costumers_create_default_department trigger's own
--    default department AND an admin's own "Ny afdeling" in
--    CostumerDetailsPage.tsx, since both are just inserts into departments)
--    seeds this same row for every new department, so it can never end up
--    missing again. SECURITY DEFINER (same pattern as
--    create_default_department_for_costumer in
--    departments_unique_per_costumer_and_auto_create.sql) so the insert
--    succeeds regardless of the inserting user's own department_settings
--    RLS.
--
-- Safe to re-run: backfill only touches rows that actually need it,
-- function is CREATE OR REPLACE, trigger dropped before recreated.

-- 1. Backfill.
insert into public.department_settings (name, value, department_id)
select 'Anvendelse', array['Andet (angiv årsag)'], d.department_id
from public.departments d
where not exists (
  select 1 from public.department_settings ds
  where ds.name = 'Anvendelse' and ds.department_id = d.department_id
);

update public.department_settings
set value = value || array['Andet (angiv årsag)']
where name = 'Anvendelse'
  and not ('Andet (angiv årsag)' = any(value));

-- 2. Trigger for future departments.
create or replace function public.seed_default_anvendelse_for_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.department_settings (name, value, department_id)
  values ('Anvendelse', array['Andet (angiv årsag)'], new.department_id)
  on conflict (name, department_id) do nothing;
  return new;
end;
$$;

drop trigger if exists departments_seed_default_anvendelse on public.departments;
create trigger departments_seed_default_anvendelse
  after insert on public.departments
  for each row
  execute function public.seed_default_anvendelse_for_department();
