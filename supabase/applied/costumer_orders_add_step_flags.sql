-- Tracks completion of each of VehicleCreatePage.tsx's three provisioning
-- steps ("2hire register vehicle", "2hire associate IoT device", "Other
-- 2hire registrations") so the page can disable a step once it's been
-- marked done, persisting across reloads/reopens rather than resetting
-- every time the order is revisited. Each button currently only shows
-- "Endnu ikke implementeret" (the real automation isn't built yet) — for
-- now, clicking it both shows that popup AND records the step as done, so
-- FLEETii staff can use this page as a manual checklist until the real
-- integrations exist.
--
-- Needs its own UPDATE policy (costumer_orders only had INSERT/SELECT/
-- DELETE until now) — FLEETii-admin-only, tighter than the other three's
-- "admin own costumer OR FLEETii admin any" scoping, since VehicleCreatePage
-- is itself only reachable by role "FLEETii admin" (see App.tsx's
-- ProtectedRoute requireRole) — a regular admin never has a reason to flip
-- these.
--
-- Safe to re-run: IF NOT EXISTS / DROP POLICY IF EXISTS make a second run a
-- no-op.

alter table public.costumer_orders
  add column if not exists vehicle_registered boolean not null default false,
  add column if not exists iot_device_associated boolean not null default false,
  add column if not exists other_2hire_done boolean not null default false;

grant update (vehicle_registered, iot_device_associated, other_2hire_done) on public.costumer_orders to authenticated;

drop policy if exists "costumer_orders_update_fleetii_admin" on public.costumer_orders;
create policy "costumer_orders_update_fleetii_admin" on public.costumer_orders
  for update
  to authenticated
  using (public.is_fleetii_admin())
  with check (public.is_fleetii_admin());
