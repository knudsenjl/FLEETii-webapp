-- Replaces user_profiles.department (text department NAME) with
-- department_id (uuid, FK to departments.department_id) — same change
-- already made to bookings.department and settings.department (see
-- supabase/applied/bookings_department_to_department_id.sql and
-- settings_department_to_department_id.sql), for the same reason:
-- departments.name is no longer the primary key, departments.department_id
-- is. Value-preserving via a join on departments.name, NOT random uuids —
-- this is a real relationship.
--
-- Drops and recreates every constraint/policy that depends on
-- "department" upfront (learned the hard way with the departments PK
-- swap and the bookings migration — better to handle these before
-- attempting the column drop, not after it fails):
--   - user_profiles_department_fkey (FK to departments(name))
--   - user_profiles_select_admin_own_department (RLS policy)
--   - user_profiles_delete_admin_own_department (RLS policy)
-- All three are recreated against department_id at the end. Run
-- rls_policies.sql (updated alongside this migration) right after this
-- file — it recreates the two policies properly; this file only drops
-- them so the column can be dropped, it does not recreate them itself
-- (matching how bookings_department_to_department_id.sql relies on
-- rls_policies.sql the same way).
--
-- RUN THIS BEFORE deploying the matching app-code change (AuthContext.tsx
-- etc.) for the same reason as the bookings/settings migrations: there's
-- an unavoidable brief window where old deployed code and the new schema
-- (or new code and the old schema) don't match. Between running this file
-- and rls_policies.sql, admins temporarily lose the ability to read/delete
-- other users in their department (RLS fails closed on a missing policy) —
-- run rls_policies.sql right after this one.
--
-- Safe to re-run: every step guarded.

-- 1. Add department_id uuid column if it doesn't already exist.
alter table public.user_profiles add column if not exists department_id uuid;

-- 2. Populate from the old department text column, matching by name.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'department'
  ) then
    update public.user_profiles
    set department_id = departments.department_id
    from public.departments
    where user_profiles.department = departments.name
      and user_profiles.department_id is null;
  end if;
end $$;

-- 3. Drop the RLS policies and FK that depend on "department".
drop policy if exists "user_profiles_select_admin_own_department" on public.user_profiles;
drop policy if exists "user_profiles_delete_admin_own_department" on public.user_profiles;
alter table public.user_profiles drop constraint if exists user_profiles_department_fkey;

-- 4. Drop the old department column.
alter table public.user_profiles drop column if exists department;

-- 5. Add the new foreign key to departments.department_id.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_department_id_fkey' and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_department_id_fkey
      foreign key (department_id) references public.departments (department_id);
  end if;
end $$;
