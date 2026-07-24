-- Adds a proper surrogate primary key to public.settings, which has had
-- none since settings_department_to_department_id.sql's migration (its
-- uniqueness is enforced entirely via three partial unique indexes —
-- settings_department_unique, settings_global_unique,
-- settings_user_override_unique — for the three-tier override precedence,
-- not a flat PK). settings_id is purely a stable row identifier; it
-- doesn't change or replace any of that existing uniqueness logic.
--
-- Safe to re-run: column add is idempotent (IF NOT EXISTS with a default,
-- so existing rows are backfilled automatically), constraint guarded by
-- existence check.

alter table public.settings add column if not exists settings_id uuid not null default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_pkey' and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings add constraint settings_pkey primary key (settings_id);
  end if;
end $$;
