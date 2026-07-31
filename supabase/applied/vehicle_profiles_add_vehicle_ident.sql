-- Adds vehicle_ident (text, nullable) to vehicle_profiles — a company-wide
-- "Bil-ID" identifier, distinct from number_plate (Nummerplade), that
-- FLEETii admins can optionally set per vehicle (HandleVehiclePage.tsx).
-- Wherever the app previously showed "Nummerplade" as a vehicle's read-only
-- display identifier, it now shows "Bil-ID" instead, falling back to
-- number_plate when vehicle_ident is null/empty (see
-- liveVehicleDataSource.ts's toVehicle2Hire). No RLS/grant changes needed —
-- vehicle_profiles' existing SELECT/UPDATE policies are row-scoped, not
-- column-scoped, so they already cover this new column.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.

alter table public.vehicle_profiles add column if not exists vehicle_ident text;
