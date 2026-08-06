-- Mirrors vehicle_profiles_add_drivmiddel.sql so "Drivmiddel" is pickable
-- already at order-fulfillment time (VehicleCreatePage.tsx), not just
-- editable afterward via HandleVehiclePage — 2hire-register-vehicle.mts
-- copies this straight onto the new vehicle_profiles row, same as
-- brand/model/model_year already are. Defaults to "Benzin" like the
-- vehicle_profiles column; existing pending orders just get that default,
-- no randomization needed here (unlike vehicle_profiles' backfill) since
-- these aren't real vehicles yet.
alter table public.costumer_orders
  add column drivmiddel text not null default 'Benzin'
    check (drivmiddel in ('Benzin', 'Diesel', 'El', 'Hybrid', 'Brint'));
