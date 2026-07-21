-- Replaces settings.department (text department NAME) with
-- settings.department_id (uuid, FK to departments.department_id) — same
-- change already made to bookings.department (see
-- supabase/applied/bookings_department_to_department_id.sql), for the
-- same reason: departments.name is no longer the primary key,
-- departments.department_id is, so this keeps the relationship pointing
-- at the actual primary key. Value-preserving via a join on
-- departments.name, NOT random uuids — this is a real relationship.
--
-- Drops and recreates every constraint/index that depends on
-- "department" (discovered the hard way with bookings — better to handle
-- them upfront here):
--   - settings_department_fkey (FK to departments(name))
--   - settings_department_unique (partial unique index referencing department)
--   - settings_global_unique (partial unique index whose WHERE clause
--     references department, even though department isn't in its column
--     list — dropping the column requires dropping this too)
-- All three are recreated against department_id at the end, unchanged in
-- behavior otherwise. settings_user_override_unique and
-- settings_user_id_fkey don't reference department at all and are
-- untouched.
--
-- RUN THIS BEFORE deploying the matching app-code change (src/lib/settings.ts
-- etc.) — until this runs, the updated code's `.eq("department_id", ...)`
-- queries would simply find nothing (column doesn't exist yet, Supabase
-- would error), and the OLD deployed code's `.eq("department", ...)`
-- queries would break the moment the column is dropped. There's an
-- unavoidable brief window between running this and deploying the new
-- code where department-scoped settings checks won't work (they'll just
-- return null "not tilladt" rather than error, since PostgREST returns an
-- empty/error result gracefully here — fails closed, not open).
--
-- Safe to re-run: every step guarded.

-- 1. Add department_id uuid column if it doesn't already exist.
alter table public.settings add column if not exists department_id uuid;

-- 2. Populate from the old department text column, matching by name.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settings' and column_name = 'department'
  ) then
    update public.settings
    set department_id = departments.department_id
    from public.departments
    where settings.department = departments.name
      and settings.department_id is null;
  end if;
end $$;

-- 3. Drop the constraints/indexes that depend on "department".
alter table public.settings drop constraint if exists settings_department_fkey;
drop index if exists settings_department_unique;
drop index if exists settings_global_unique;

-- 4. Drop the old department column.
alter table public.settings drop column if exists department;

-- 5. Add the new foreign key to departments.department_id.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_department_id_fkey' and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_department_id_fkey
      foreign key (department_id) references public.departments (department_id);
  end if;
end $$;

-- 6. Recreate the two partial unique indexes against department_id.
create unique index if not exists settings_department_unique
  on public.settings (name, department_id)
  where user_id is null and department_id is not null;

create unique index if not exists settings_global_unique
  on public.settings (name)
  where user_id is null and department_id is null;
