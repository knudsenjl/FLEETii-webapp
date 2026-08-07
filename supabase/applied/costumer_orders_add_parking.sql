-- Mirrors vehicle_profiles_add_parking.sql so "P-plads" is collectable
-- already at request time (NewVehiclePage.tsx) — 2hire-register-vehicle.mts
-- copies this straight onto the new vehicle_profiles row, same as
-- brand/model/model_year/drivmiddel already are. No backfill needed:
-- existing pending orders just stay null, same as brand/model do.
alter table public.costumer_orders add column parking text;
