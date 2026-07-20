-- Replaces bookings.department (text department NAME, e.g. "FLEETii")
-- with bookings.department_id (uuid, referencing departments.department_id)
-- — value-preserving via a join on departments.name, NOT random uuids
-- (unlike vehicle_log/bookings.booking_id's conversions): this column is a
-- real relationship to departments, not an opaque per-row identifier, so
-- losing the association would silently break every department-scoped
-- query in the app.
--
-- RUN THIS AFTER departments_department_id_pk.sql (department_id needs to
-- actually be populated/unique on departments first) but BEFORE
-- rls_policies.sql — its CREATE POLICY statements reference
-- bookings.department_id directly, which Postgres validates exists at
-- creation time, so they'll fail if run first. This file drops the two
-- OLD department-based policies itself (step 3 below) before dropping the
-- column, since Postgres won't drop a column a policy still depends on;
-- rls_policies.sql's own DROP POLICY IF EXISTS for the same names then
-- just no-ops when it runs after this and creates the new department_id
-- versions. Between running this file and rls_policies.sql, bookings has
-- NO insert/delete policy at all (RLS fails closed on a missing policy) —
-- reads still work fine (bookings_select_authenticated is untouched), but
-- creating/cancelling a reservation will be blocked for everyone until
-- rls_policies.sql runs. Run it right after this one.
--
-- Safe to re-run: guarded at each step. Rows whose old department name
-- didn't match any departments.name are left with a null department_id
-- (matching the old column's nullability) rather than guessed — check for
-- these before dropping "department" if you want to catch typos/orphaned
-- department names first:
--   select booking_id, department from public.bookings
--   where department is not null
--     and not exists (select 1 from public.departments d where d.name = bookings.department);

-- 1. Add department_id uuid column if it doesn't already exist.
alter table public.bookings add column if not exists department_id uuid;

-- 2. Populate from the old department text column, matching by name — only
--    if that column still exists (so this step cleanly no-ops on a second
--    run, after step 3 below has already dropped it).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'department'
  ) then
    update public.bookings
    set department_id = departments.department_id
    from public.departments
    where bookings.department = departments.name
      and bookings.department_id is null;
  end if;
end $$;

-- 3. Drop the two OLD policies that reference "department" directly —
--    Postgres refuses to drop a column a policy depends on. Safe/idempotent:
--    DROP POLICY IF EXISTS. rls_policies.sql recreates the department_id
--    versions of both when it runs after this file.
drop policy if exists "bookings_insert_own_department" on public.bookings;
drop policy if exists "bookings_delete_own_or_department_admin" on public.bookings;

-- 4. Drop the old department column.
alter table public.bookings drop column if exists department;

-- 5. Add a foreign key so department_id can't silently drift from a real
--    department (departments.department_id must already be that table's
--    primary key — see departments_department_id_pk.sql — for this to
--    succeed).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_department_id_fkey' and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_department_id_fkey
      foreign key (department_id) references public.departments (department_id);
  end if;
end $$;
