-- Retry of departments_department_id_pk.sql: that one failed with
-- "cannot drop constraint departments_pkey ... because other objects
-- depend on it" — two foreign keys neither tracked migration nor this
-- session's exploration knew about: settings.department and
-- user_profiles.department both reference departments(name), which is
-- currently the primary key.
--
-- Order here matters and is deliberately structured to avoid ever having
-- two unique constraints simultaneously covering "name" (which would make
-- it ambiguous which one a recreated FK binds to, and could silently
-- reproduce the exact same drop failure later):
--   1. Capture the two FKs' exact current definitions (via
--      pg_get_constraintdef, not assumed ON DELETE/ON UPDATE behavior).
--   2. Drop both FKs — frees departments_pkey from any dependency.
--   3. Drop the old departments_pkey (on "name") — now safe.
--   4. Add the new primary key on department_id.
--   5. Add a standalone UNIQUE constraint on "name" (the only thing
--      covering it at this point).
--   6. Recreate both FKs from their captured definitions — bind
--      unambiguously to the new unique constraint just added.
--
-- Net effect: department_id becomes the sole primary key; "name" keeps a
-- plain UNIQUE constraint (not primary key), so settings.department and
-- user_profiles.department keep working exactly as before, untouched.
--
-- Safe to re-run: every step is guarded.

do $$
declare
  settings_fk_def text;
  user_profiles_fk_def text;
  pk_name text;
begin
  -- 1. Capture the two FKs' definitions, if they still exist.
  select pg_get_constraintdef(oid) into settings_fk_def
  from pg_constraint
  where conname = 'settings_department_fkey' and conrelid = 'public.settings'::regclass;

  select pg_get_constraintdef(oid) into user_profiles_fk_def
  from pg_constraint
  where conname = 'user_profiles_department_fkey' and conrelid = 'public.user_profiles'::regclass;

  -- 2. Drop both FKs (if present).
  if settings_fk_def is not null then
    execute 'alter table public.settings drop constraint settings_department_fkey';
  end if;
  if user_profiles_fk_def is not null then
    execute 'alter table public.user_profiles drop constraint user_profiles_department_fkey';
  end if;

  -- 3 & 4. Swap the primary key from whatever it currently is to
  -- department_id (no-ops if department_id is already the PK).
  select conname into pk_name
  from pg_constraint
  where conrelid = 'public.departments'::regclass and contype = 'p';

  if pk_name is not null and not exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conname = pk_name and a.attname = 'department_id'
  ) then
    execute format('alter table public.departments drop constraint %I', pk_name);
    pk_name := null;
  end if;

  if pk_name is null then
    alter table public.departments add primary key (department_id);
  end if;

  -- 5. Give "name" its own standalone unique constraint, if it doesn't
  -- have one yet (it won't, the first time this runs, since the PK just
  -- moved off of it).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.departments'::regclass
      and contype = 'u'
      and conname = 'departments_name_key'
  ) then
    alter table public.departments add constraint departments_name_key unique (name);
  end if;

  -- 6. Recreate the two FKs, unchanged, now bound to that unique
  -- constraint instead of the old primary key.
  if settings_fk_def is not null and not exists (
    select 1 from pg_constraint
    where conname = 'settings_department_fkey' and conrelid = 'public.settings'::regclass
  ) then
    execute format('alter table public.settings add constraint settings_department_fkey %s', settings_fk_def);
  end if;

  if user_profiles_fk_def is not null and not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_department_fkey' and conrelid = 'public.user_profiles'::regclass
  ) then
    execute format('alter table public.user_profiles add constraint user_profiles_department_fkey %s', user_profiles_fk_def);
  end if;
end $$;
