-- Creates costumer_orders: a record of every "send bestilling til FLEETii"
-- vehicle-request submission (NewVehiclePage.tsx), inserted right before the
-- email itself is sent (see send-vehicle-request.mts) so the request exists
-- as real data even if the email later fails/is missed, not just a mail
-- FLEETii staff might lose track of.
--
-- Column choices mirror vehicle_profiles' own naming (number_plate, brand,
-- model, model_year) since this order is, conceptually, a future
-- vehicle_profiles row once FLEETii staff actually provisions the vehicle —
-- department_id is nullable for the same reason vehicle_profiles.department_id
-- is (a FLEETii admin submitting on behalf of a costumer they don't
-- themselves belong to would have no department of their own to attribute
-- this to, though in practice this page is only ever reached by a regular
-- admin with a real one).
--
-- No SELECT policy yet, deliberately — only INSERT was asked for. Add one
-- (admin's own costumer / FLEETii admin any) if/when something needs to
-- actually list these.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, GRANT/policy are idempotent.

create table if not exists public.costumer_orders (
  order_id uuid primary key default gen_random_uuid(),
  costumer_id uuid not null references public.costumers(costumer_id),
  department_id uuid references public.departments(department_id),
  number_plate text not null,
  brand text not null,
  model text not null,
  model_year text not null,
  needs_fleetii_device boolean not null default true,
  -- Only meaningful when needs_fleetii_device is false (the vehicle already
  -- has one) — mirrors vehicle_profiles.iot_id, named for this table's own
  -- "FLEETii device id" field instead since the two aren't guaranteed to be
  -- the exact same identifier space.
  fleetii_device_id text,
  kontaktperson text not null,
  kontaktnummer text not null,
  created_at timestamptz not null default now()
);

alter table public.costumer_orders enable row level security;

grant insert on public.costumer_orders to authenticated;

drop policy if exists "costumer_orders_insert_admin_own_costumer" on public.costumer_orders;
create policy "costumer_orders_insert_admin_own_costumer" on public.costumer_orders
  for insert
  to authenticated
  with check (
    public.is_fleetii_admin()
    or (public.is_admin() and costumer_id = public.current_costumer_id())
  );
