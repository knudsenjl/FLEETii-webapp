-- Adds contactemail to costumer_orders — a new "Kontakt e-mail:" field
-- shown right after Kontaktperson in both order types: a required form
-- field on the "Opret" side (NewVehiclePage.tsx, alongside contactperson/
-- contactnumber), server-resolved from the caller's own user_profiles.email
-- on the "Nedlæg" side (send-vehicle-deletion-request.mts, same as
-- contactperson/contactnumber already are). Nullable like contactnumber
-- (see costumer_orders_merge_deletion_requests.sql) rather than NOT NULL,
-- since existing rows have none and a Nedlæg row's caller could in theory
-- have no email on file.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.

alter table public.costumer_orders
  add column if not exists contactemail text;
