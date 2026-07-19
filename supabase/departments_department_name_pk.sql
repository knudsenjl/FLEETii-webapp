-- Makes department_name the primary key of public.departments (replacing
-- whatever column is the PK today, e.g. an id/department_tag column), then
-- drops department_tag entirely. No app code references department_tag
-- (confirmed via a full-repo search) — it's only ever department_name that
-- gets read (see departments_select_policy.sql / UserDetailsPage.tsx's
-- "Afdeling" dropdown), so this is safe from the application's side.
--
-- Deliberately does NOT use CASCADE when dropping the old primary key: if
-- some other table has a foreign key pointing at departments' current PK
-- (nothing in this repo's tracked SQL does, but see
-- project_missing_table_grants_after_rename.md — this DB has drifted from
-- tracked migrations before), the DROP CONSTRAINT below will fail loudly
-- with a clear "other objects depend on it" error instead of silently
-- severing that relationship. If it does fail, stop and report back the
-- error rather than re-running with CASCADE.
--
-- Also NOT idempotent-safe to blindly re-run after department_tag is gone
-- (the last statement would then just no-op via IF EXISTS, but the PK swap
-- itself only runs once since it exits early if department_name is already
-- the primary key).

-- 1. department_name must be NOT NULL and unique to become a primary key.
--    Fails loudly (clear constraint-violation error) if current data has
--    duplicate or null department_name values — that's real data to fix,
--    not something to paper over here.
alter table public.departments alter column department_name set not null;

-- 2. Swap the primary key from whatever it is today to department_name.
do $$
declare
  pk_name text;
begin
  select conname into pk_name
  from pg_constraint
  where conrelid = 'public.departments'::regclass and contype = 'p';

  -- Already department_name? Nothing to do.
  if pk_name is not null and exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conname = pk_name and a.attname = 'department_name'
  ) then
    return;
  end if;

  if pk_name is not null then
    execute format('alter table public.departments drop constraint %I', pk_name);
  end if;

  alter table public.departments add primary key (department_name);
end $$;

-- 3. Drop department_tag now that nothing (PK included) depends on it.
alter table public.departments drop column if exists department_tag;
