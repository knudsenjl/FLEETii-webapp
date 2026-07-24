-- Two related changes to department_settings/user_settings, needed
-- together for the new "Rettigheder" checkbox UI:
--
-- 1. Renames the three permission-flag settings from Bruger_* to Tillad_*
--    (Bruger_ny_reservation -> Tillad_ny_reservation,
--    Bruger_ret_reservation -> Tillad_rediger_reservation,
--    Bruger_slet_reservation -> Tillad_slet_reservation) in both tables.
--
-- 2. Adds a genuine boolean column (value_bool) for these flag-shaped
--    settings, instead of overloading the existing `value text[]` column
--    (which stays as-is for list-shaped settings like "Anvendelse" — a
--    single column can't be both types, hence the second column rather
--    than converting `value` itself). Converts each renamed row's
--    ["Tilladt"] into value_bool = true and clears its old `value` to
--    null (confirmed via diagnostic this session: all 3 existing rows are
--    exactly ["Tilladt"], all in department_settings, none in
--    user_settings yet).
--
-- Safe to re-run: every step guarded/idempotent.

alter table public.department_settings add column if not exists value_bool boolean;
alter table public.user_settings add column if not exists value_bool boolean;

-- `value` must become nullable in both tables — a Tillad_* row uses
-- value_bool instead and has no array value at all.
alter table public.department_settings alter column value drop not null;
alter table public.user_settings alter column value drop not null;

update public.department_settings
set name = 'Tillad_ny_reservation'
where name = 'Bruger_ny_reservation';
update public.department_settings
set name = 'Tillad_rediger_reservation'
where name = 'Bruger_ret_reservation';
update public.department_settings
set name = 'Tillad_slet_reservation'
where name = 'Bruger_slet_reservation';

update public.user_settings
set name = 'Tillad_ny_reservation'
where name = 'Bruger_ny_reservation';
update public.user_settings
set name = 'Tillad_rediger_reservation'
where name = 'Bruger_ret_reservation';
update public.user_settings
set name = 'Tillad_slet_reservation'
where name = 'Bruger_slet_reservation';

update public.department_settings
set value_bool = (value = array['Tilladt']), value = null
where name in ('Tillad_ny_reservation', 'Tillad_rediger_reservation', 'Tillad_slet_reservation')
  and value_bool is null;

update public.user_settings
set value_bool = (value = array['Tilladt']), value = null
where name in ('Tillad_ny_reservation', 'Tillad_rediger_reservation', 'Tillad_slet_reservation')
  and value_bool is null;
