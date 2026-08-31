-- Adds registration_claimed_at, the atomic "registration in progress" lock
-- 2hire-register-vehicle.mts claims before ever calling 2hire's
-- registerVehicle() -- without it, two concurrent requests for the same
-- order could both read vehicle_id IS NULL, both call registerVehicle (each
-- provisioning a SEPARATE real 2hire device/vehicle for the same physical
-- QR code), then race to persist their own resulting vehicleId onto the
-- order -- the last write wins, silently orphaning the other real 2hire
-- vehicle (no matching vehicle_profiles row, no way to discover it again).
--
-- Nullable timestamptz, not a boolean: a plain "claimed" flag can never
-- self-heal if the claiming request crashes/times out mid-registration
-- (Netlify Function execution limit, an unhandled error, etc.) -- a
-- timestamp lets the function's own claim UPDATE also treat a sufficiently
-- OLD claim as abandoned and safely reclaim it, rather than permanently
-- locking that order out of ever being registered again. See
-- 2hire-register-vehicle.mts's own doc comment for the exact staleness
-- window and the UPDATE ... WHERE ... this column exists for.
--
-- Applied to FLEETii-DB-Staging on 2026-08-31. Safe to re-run: column add
-- is guarded.

alter table public.costumer_orders
  add column if not exists registration_claimed_at timestamptz;
