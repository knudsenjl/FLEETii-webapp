-- Adds a value_text column to department_settings/user_settings for the two
-- new scalar-string settings "Standard_varighed" ("HH:MM") and
-- "Standard_interval" ("MM") — distinct from the existing `value` text[]
-- column (list-shaped settings like "Anvendelse") and `value_bool` boolean
-- column (flag-shaped Tillad_* settings, see
-- rename_bruger_to_tillad_and_add_bool.sql). No RLS/policy changes needed:
-- these two setting names aren't in the Tillad_* list, so the existing
-- insert/update policies (settings_write_policies.sql,
-- user_settings_restrict_tillad_writes.sql) already let an admin write their
-- department's row and any user write their own row.
--
-- Safe to re-run: idempotent column adds.

alter table public.department_settings add column if not exists value_text text;
alter table public.user_settings add column if not exists value_text text;
