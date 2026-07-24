-- Splits the single "settings" table (three tiers in one table: global,
-- department-scoped, user-scoped — via nullable department_id/user_id and
-- three partial unique indexes, see settings_department_nullable.sql) into
-- two purpose-specific tables:
--   - department_settings: name, value, department_id (NOT NULL) — every
--     row belongs to a specific department.
--   - user_settings (renamed from settings): name, value, user_id (NOT
--     NULL) — every row belongs to a specific user.
-- The global tier (both department_id and user_id null) is eliminated
-- entirely per this decision — confirmed via a diagnostic query this
-- session that none of the 4 existing rows are actually global (all 4
-- have department_id set, none have user_id set), so nothing is lost in
-- practice. src/lib/settings.ts's fetchSettingValue/isSettingTilladt
-- (which currently implement the 3-tier precedence, including a global
-- fallback) need a matching follow-up code change — NOT done by this
-- migration, since the whole point of splitting first is to verify the
-- DB side independently before touching app code.
--
-- Safe to re-run: every step guarded (checks existence before acting).

-- 1. New department_settings table, seeded from every current settings
--    row (all of which are department-scoped today).
create table if not exists public.department_settings (
  department_settings_id uuid not null default gen_random_uuid() primary key,
  name text not null,
  value text[] not null,
  department_id uuid not null references public.departments (department_id),
  unique (name, department_id)
);

insert into public.department_settings (name, value, department_id)
select name, value, department_id
from public.settings
where department_id is not null
on conflict (name, department_id) do nothing;

-- 2. Rename settings -> user_settings (RLS policies stay attached across
--    a rename automatically, since they're tied to the table's OID, not
--    its name — renamed here too just for clarity, not functionally
--    required).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'settings') then
    alter table public.settings rename to user_settings;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_settings' and policyname = 'settings_select_authenticated'
  ) then
    alter policy "settings_select_authenticated" on public.user_settings rename to "user_settings_select_authenticated";
  end if;
end $$;

-- 3. Drop what's about to be removed from user_settings: the FK/indexes
--    that reference department_id, then the rows that were migrated to
--    department_settings in step 1 (anything with a null user_id — every
--    real user_settings row must have one from here on).
alter table public.user_settings drop constraint if exists settings_department_id_fkey;
drop index if exists settings_user_override_unique;
drop index if exists settings_department_unique;
drop index if exists settings_global_unique;

delete from public.user_settings where user_id is null;

alter table public.user_settings drop column if exists department_id;
alter table public.user_settings alter column user_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_settings_name_user_id_key' and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings add constraint user_settings_name_user_id_key unique (name, user_id);
  end if;
end $$;

-- 4. Rename the PK column to match the table (settings_id -> user_settings_id).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_settings' and column_name = 'settings_id'
  ) then
    alter table public.user_settings rename column settings_id to user_settings_id;
  end if;
end $$;

-- 5. RLS + grant for the new department_settings table, mirroring
--    user_settings' own permissive "any authenticated user may read"
--    policy (settings aren't sensitive — app-wide dropdown/flag config).
grant select on public.department_settings to authenticated;

alter table public.department_settings enable row level security;

drop policy if exists "department_settings_select_authenticated" on public.department_settings;
create policy "department_settings_select_authenticated"
  on public.department_settings for select
  to authenticated
  using (true);
