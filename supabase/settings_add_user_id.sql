-- Adds a "user_id" column to settings, referencing user_profiles(user_id) —
-- lets a settings row optionally be scoped to a specific user (in addition
-- to, or instead of, the existing department scoping), nullable so every
-- existing app-wide/department-wide row keeps working unchanged.
--
-- Safe to re-run: the column add is natively idempotent (IF NOT EXISTS);
-- the foreign key is added only if it doesn't already exist.

alter table public.settings add column if not exists user_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_user_id_fkey' and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_user_id_fkey
      foreign key (user_id) references public.user_profiles(user_id);
  end if;
end $$;
