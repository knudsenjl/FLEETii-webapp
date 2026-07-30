-- Adds two optional fields to costumer_orders (the "Opret nyt køretøj"
-- request NewVehiclePage.tsx submits via send-vehicle-request.mts): the
-- vehicle's current fuel level ("Brændstofniveau") and mileage
-- ("Kilometerstand") at the time of the request — useful context for FLEETii
-- staff onboarding a used vehicle, before any 2hire device/telemetry exists
-- for it. Free-text like every other field on this table (number_plate,
-- brand, model, model_year) rather than numeric, since the admin filling out
-- the form may write e.g. "72%" or "12.345 km". Nullable: not always known
-- (e.g. a genuinely new vehicle) and not required on the form.

alter table public.costumer_orders
  add column if not exists fuel_level text,
  add column if not exists mileage text;
