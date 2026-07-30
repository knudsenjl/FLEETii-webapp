-- Creates vehicle_deletion_requests: a record of every "please delete this
-- vehicle" request (VehicleDetailsPage.tsx's "Slet køretøj"), plus the
-- delete_vehicle() function that actually performs the deletion once FLEETii
-- staff has fulfilled the request.
--
-- "Slet køretøj" mirrors "Opret køretøj" (see costumer_orders_table.sql), in
-- reverse: a customer admin can't delete a vehicle unilaterally, since the
-- physical 2hire board installed in it has to be removed and the vehicle
-- deregistered from 2hire, both FLEETii's job. So the admin's click only
-- records a request + emails FLEETii (send-vehicle-deletion-request.mts);
-- FLEETii staff confirm the physical device removal and then trigger the
-- real deletion (delete-vehicle.mts, via delete_vehicle() below) from
-- VehicleDeletePage.tsx.
--
-- Column choices mirror costumer_orders' own snapshot pattern (number_plate,
-- brand, model, model_year copied at request time rather than joined live)
-- since the underlying vehicle_profiles row is gone by the time the request
-- is fulfilled. vehicle_id has no FK for the same reason bookings.vehicle_id
-- doesn't: the row it points to gets deleted as part of fulfilling this very
-- request.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, GRANT/policy/function are
-- idempotent (create-or-replace / drop-if-exists).

create table if not exists public.vehicle_deletion_requests (
  request_id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  costumer_id uuid not null references public.costumers(costumer_id),
  department_id uuid references public.departments(department_id),
  number_plate text not null,
  brand text not null,
  model text not null,
  model_year text not null,
  -- Resolved from the requesting admin's own user_profiles row (full_name/
  -- email, phone) server-side, not a form field — unlike costumer_orders'
  -- contactperson/contactnumber, contactnumber here is nullable since phone
  -- itself is nullable on user_profiles and there's no form to force it.
  contactperson text not null,
  contactnumber text,
  device_removed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.vehicle_deletion_requests enable row level security;

grant insert, select, delete on public.vehicle_deletion_requests to authenticated;

drop policy if exists "vehicle_deletion_requests_insert_admin_own_costumer" on public.vehicle_deletion_requests;
create policy "vehicle_deletion_requests_insert_admin_own_costumer" on public.vehicle_deletion_requests
  for insert
  to authenticated
  with check (
    public.is_fleetii_admin()
    or (public.is_admin() and costumer_id = public.current_costumer_id())
  );

drop policy if exists "vehicle_deletion_requests_select_admin_own_costumer" on public.vehicle_deletion_requests;
create policy "vehicle_deletion_requests_select_admin_own_costumer" on public.vehicle_deletion_requests
  for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or (public.is_admin() and costumer_id = public.current_costumer_id())
  );

drop policy if exists "vehicle_deletion_requests_delete_admin_own_costumer" on public.vehicle_deletion_requests;
create policy "vehicle_deletion_requests_delete_admin_own_costumer" on public.vehicle_deletion_requests
  for delete
  to authenticated
  using (
    public.is_fleetii_admin()
    or (public.is_admin() and costumer_id = public.current_costumer_id())
  );

-- The real, terminal deletion — SECURITY DEFINER, execute revoked from
-- anon/authenticated, callable only via the service-role client from
-- delete-vehicle.mts (see purge_costumer/costumer_purge_function.sql for the
-- identical trust-boundary pattern: no ownership check in here, the caller
-- is fully trusted since it's only reachable from a requireFleetiiAdmin-
-- gated function). Deliberately does NOT touch bookings — no FK forces it,
-- and booking history should survive a vehicle leaving the fleet.
create or replace function public.delete_vehicle(target_vehicle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.vehicle_departments where vehicle_id = target_vehicle_id;
  delete from public.vehicle_signals where vehicle_id = target_vehicle_id;
  delete from public.vehicle_profiles where vehicle_id = target_vehicle_id;
end;
$$;

revoke all on function public.delete_vehicle(uuid) from public;
revoke execute on function public.delete_vehicle(uuid) from anon, authenticated;
