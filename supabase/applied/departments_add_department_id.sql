-- Adds a nullable "department_id" uuid column to public.departments. No
-- default, no constraints, no foreign key — just the column itself, since
-- none were specified. departments currently has "name" as its primary key
-- (see departments_department_name_pk.sql), so department_id is a separate
-- identifier from that; if it's meant to be auto-generated (default
-- gen_random_uuid()), unique, or referenced from other tables, say so and
-- this can be extended.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.

alter table public.departments
  add column if not exists department_id uuid;
