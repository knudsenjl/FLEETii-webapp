-- Adds vehicle_ident (text, nullable) to costumer_orders — lets a customer
-- admin optionally suggest a company-wide "Bil-ID" for a new vehicle at
-- request time (NewVehiclePage.tsx), alongside the required Nummerplade.
-- FLEETii's own 2hire-register-vehicle.mts carries it straight onto the
-- created vehicle_profiles row (see vehicle_profiles_add_vehicle_ident.sql)
-- so it doesn't have to be re-entered later via HandleVehiclePage.tsx.
-- No RLS/grant changes needed — costumer_orders' existing policies are
-- row-scoped, not column-scoped, so they already cover this new column.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.

alter table public.costumer_orders add column if not exists vehicle_ident text;
