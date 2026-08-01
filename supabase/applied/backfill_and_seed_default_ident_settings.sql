-- Seeds 'use_user_ident' and 'use_vehicle_ident' (value_bool, default false)
-- into department_settings for every existing department, and installs a
-- trigger so future departments get them too — same two-step pattern as
-- backfill_and_seed_default_anvendelse.sql, but for these two flags.
--
-- Unlike the Tillad_* permission flags (RettighederSettings.tsx's own
-- RETTIGHEDER list), which rely on "missing row = false" and are never
-- seeded, these two are explicitly seeded per the feature request — a real
-- row exists for every department from the start, not just once an admin
-- first toggles it.
--
-- Controls two checkbox rows (Anvender Ansat-ID / Anvender Køretøj-ID)
-- inside SettingsAdminPage's existing "Indstillinger" table (see
-- StandardSettings.tsx's "checkbox" inputType). Note: as of this migration,
-- nothing in the app yet READS these two flags to decide whether Ansat-ID/
-- Køretøj-ID is actually shown as the primary identifier — this only adds
-- the settings rows and the toggle UI.
--
-- Safe to re-run: both inserts use ON CONFLICT DO NOTHING, and the function/
-- trigger are CREATE OR REPLACE / dropped-and-recreated.

insert into public.department_settings (name, value_bool, department_id)
select 'use_user_ident', false, department_id from public.departments
on conflict (name, department_id) do nothing;

insert into public.department_settings (name, value_bool, department_id)
select 'use_vehicle_ident', false, department_id from public.departments
on conflict (name, department_id) do nothing;

create or replace function public.seed_default_ident_settings_for_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.department_settings (name, value_bool, department_id)
  values ('use_user_ident', false, new.department_id)
  on conflict (name, department_id) do nothing;

  insert into public.department_settings (name, value_bool, department_id)
  values ('use_vehicle_ident', false, new.department_id)
  on conflict (name, department_id) do nothing;

  return new;
end;
$$;

drop trigger if exists departments_seed_default_ident_settings on public.departments;
create trigger departments_seed_default_ident_settings
  after insert on public.departments
  for each row
  execute function public.seed_default_ident_settings_for_department();
