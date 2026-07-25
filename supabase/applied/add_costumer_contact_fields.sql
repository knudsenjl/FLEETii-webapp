-- Adds five optional business-detail columns to costumers, shown/edited on
-- CostumerDetailsPage.tsx above the Afdelinger row: CVR, address, contact
-- person, phone, email. All nullable — unlike "Navn", none of these are
-- required to create/keep a costumer record.
--
-- No RLS changes needed: costumers_select_policy.sql is already open to any
-- authenticated user, and costumers_update_fleetii_admin (costumers_update_
-- delete_policy.sql) already covers any column for a FLEETii admin.
--
-- Safe to re-run: idempotent column adds.

alter table public.costumers add column if not exists cvr text;
alter table public.costumers add column if not exists address text;
alter table public.costumers add column if not exists contact_person text;
alter table public.costumers add column if not exists phone text;
alter table public.costumers add column if not exists email text;
