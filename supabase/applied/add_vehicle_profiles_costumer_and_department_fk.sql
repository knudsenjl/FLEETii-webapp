-- Adds direct costumer_id/department_id FK columns to vehicle_profiles,
-- mirroring user_profiles' shape (which has both a direct department_id AND
-- a separate many-to-many grants table — user_departments there,
-- vehicle_departments here). department_id here means this vehicle's
-- "home" department — backfilled to its "Alle køretøjer" department, since
-- every vehicle is already guaranteed to have exactly one of those per
-- costumer (see backfill_and_assign_vehicles_to_alle_koretojer.sql).
-- costumer_id is just that department's own costumer_id.
--
-- This simplifies queries that otherwise have to join through
-- vehicle_departments -> departments just to find a vehicle's costumer
-- (e.g. HandleVehiclePage.tsx's department picker, the vehicle_departments
-- migrations' own backfills) — it does NOT replace vehicle_departments,
-- which stays the source of truth for which department(s) a vehicle is
-- actually visible/bookable from.
--
-- Both columns are nullable: there's no trigger populating them for future
-- vehicle_profiles inserts (vehicles aren't created directly by the app —
-- see NewVehiclePage.tsx's request-email flow — and at insert time there's
-- no vehicle_departments row yet to derive a department from, unlike this
-- one-time backfill which already has that data to work with).
--
-- Safe to re-run: column adds guarded, backfill only touches null rows.

alter table public.vehicle_profiles add column if not exists costumer_id uuid references public.costumers (costumer_id);
alter table public.vehicle_profiles add column if not exists department_id uuid references public.departments (department_id);

update public.vehicle_profiles vp
set department_id = alle.department_id,
    costumer_id = alle.costumer_id
from public.vehicle_departments vd
join public.departments alle on alle.department_id = vd.department_id and alle.name = 'Alle køretøjer'
where vd.vehicle_id = vp.vehicle_id
  and vp.department_id is null;
