-- Merges vehicle_deletion_requests into costumer_orders via a new
-- order_type column ('Opret' | 'Nedlæg') — the two tables were two sides of
-- the same "administration af installationer/sletning" coin
-- (FleetiiAdministrationPage.tsx), duplicating almost the same shape
-- (costumer_id/department_id/number_plate/brand/model/model_year/
-- contactperson/contactnumber/created_at) for no real structural reason.
-- FleetiiAdministrationPage.tsx's two separate lists become one
-- ("Administration af installationer"), with a new "Type" column as the
-- first column.
--
-- vehicle_id/device_removed are new, Nedlæg-only columns (an Opret row has
-- no vehicle yet, so vehicle_id is nullable); needs_fleetii_device/
-- fleetii_device_id/vehicle_registered/iot_device_associated/
-- other_2hire_done remain Opret-only, left at their inert defaults on
-- migrated Nedlæg rows. contactnumber is relaxed to nullable, since a
-- Nedlæg row's contact info is resolved from the requesting admin's own
-- (possibly phone-less) profile, not a required form field like Opret's.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS / idempotent backfill guarded by
-- WHERE order_type IS NULL; the vehicle_deletion_requests migrate-then-drop
-- step is naturally a no-op on a second run (table won't exist anymore).

alter table public.costumer_orders
  add column if not exists order_type text,
  add column if not exists vehicle_id uuid,
  add column if not exists device_removed boolean not null default false;

update public.costumer_orders set order_type = 'Opret' where order_type is null;

alter table public.costumer_orders
  alter column order_type set not null,
  alter column order_type set default 'Opret',
  alter column contactnumber drop not null;

alter table public.costumer_orders drop constraint if exists costumer_orders_order_type_check;
alter table public.costumer_orders
  add constraint costumer_orders_order_type_check check (order_type in ('Opret', 'Nedlæg'));

grant update (device_removed) on public.costumer_orders to authenticated;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'vehicle_deletion_requests'
  ) then
    insert into public.costumer_orders (
      order_type, vehicle_id, costumer_id, department_id, number_plate, brand, model, model_year,
      needs_fleetii_device, contactperson, contactnumber, device_removed, created_at
    )
    select
      'Nedlæg', vehicle_id, costumer_id, department_id, number_plate, brand, model, model_year,
      false, contactperson, contactnumber, device_removed, created_at
    from public.vehicle_deletion_requests;

    drop table public.vehicle_deletion_requests;
  end if;
end;
$$;
