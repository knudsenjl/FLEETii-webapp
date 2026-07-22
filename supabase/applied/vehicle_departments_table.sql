-- Adds a "vehicle_departments" join table modeling which real department(s)
-- (public.departments) a vehicle belongs to — replacing
-- vehicle_profiles.departments (a free-text text[], populated at seed time
-- with values like 'Jonas Hjort'/'FLEETii (test biler)' that never actually
-- matched any real departments.name; confirmed via diagnostic query this
-- session, root cause of "fleet table shows no vehicles"). Mirrors
-- user_departments_table.sql's shape/reasoning.
--
-- Unlike user_departments, a vehicle has no "currently active" analog — every
-- row here just means "this vehicle is visible/bookable from that
-- department." No RLS changes: vehicle_profiles stays permissive to any
-- authenticated user, matching vehicle_profiles_rls.sql's existing note that
-- department scoping is done client-side for vehicles today.
--
-- Backfill mapping (from this session's diagnostic query results — verified
-- against costumers, not guessed):
--   'Jonas Hjort'            -> Udlejningsbiler (9d1a5566-79fb-48bd-9832-a0864b3d362f)
--     (the only department under costumer "Jonas Hjort")
--   'FLEETii (test biler)'   -> Test biler (2b01999f-3b8c-4f5d-9661-c87df1b002df)
--     (under costumer "FLEETII"; the parenthetical names the department directly)
--
-- Safe to re-run: guarded at each step.

-- 1. The join table itself. No ON DELETE CASCADE, matching every other FK
--    in this schema.
create table if not exists public.vehicle_departments (
  vehicle_id uuid not null references public.vehicle_profiles (vehicle_id),
  department_id uuid not null references public.departments (department_id),
  created_at timestamptz not null default now(),
  primary key (vehicle_id, department_id)
);

-- 2. Backfill via an explicit tag -> department_id mapping (can't backfill
--    by name match — the tags never matched departments.name at all).
insert into public.vehicle_departments (vehicle_id, department_id)
select vp.vehicle_id, m.department_id
from public.vehicle_profiles vp
join (
  values
    ('Jonas Hjort', '9d1a5566-79fb-48bd-9832-a0864b3d362f'::uuid),
    ('FLEETii (test biler)', '2b01999f-3b8c-4f5d-9661-c87df1b002df'::uuid)
) as m(tag, department_id) on m.tag = any (vp.departments)
on conflict (vehicle_id, department_id) do nothing;

-- 3. Drop the now-superseded free-text column, matching this session's
--    established pattern of retiring a text relational column once its real
--    FK-based replacement is confirmed backfilled.
alter table public.vehicle_profiles drop column if exists departments;
