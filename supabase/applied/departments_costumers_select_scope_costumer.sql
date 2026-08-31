-- Scopes departments/costumers SELECT to the caller's own costumer (tenant
-- isolation). Both policies shipped as `using (true)` with a "names aren't
-- sensitive" justification (departments_select_policy.sql/
-- costumers_select_policy.sql) -- true for department NAMES alone, but both
-- tables have since grown real business PII: departments.address, and
-- costumers.cvr/contact_person/phone/email/address_street/
-- address_postal_city/address_country. twohire_client_secret is separately
-- protected at the column-GRANT level already (see
-- costumers_add_twohire_credentials.sql) and is untouched here -- this is
-- purely a row-visibility (RLS) fix. Any authenticated user of ANY costumer
-- could read every OTHER costumer's full CVR/contact/address directory via
-- a direct Supabase REST call -- same class of leak as every other table
-- fixed this session (vehicle_profiles/vehicle_signals/vehicle_departments/
-- bookings).
--
-- Fixed the same way: public.is_fleetii_admin() (platform-wide, unscoped)
-- or an exact costumer_id match via public.current_costumer_id() -- both
-- tables already have their own costumer_id column (departments directly;
-- costumers IS the costumer row, matched on its own primary key), so no
-- join is needed, unlike vehicle_signals/vehicle_departments.
--
-- Verified safe against every current departments/costumers call site in
-- src/ and netlify/functions/ before applying: every Netlify function reads
-- via the service-role client (bypasses RLS, unaffected); every client-side
-- cross-costumer read is already gated on isFleetiiAdmin or a
-- FLEETii-admin-only route, or is scoped through another already-RLS-scoped
-- table (bookings/vehicle_profiles) that pins costumer_id to the caller's
-- own. No application code changes needed.
--
-- Applied to FLEETii-DB-Staging on 2026-08-31. Safe to re-run: policies
-- dropped before recreated.

drop policy if exists "departments_select_authenticated" on public.departments;
create policy "departments_select_authenticated" on public.departments
  for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or costumer_id = public.current_costumer_id()
  );

drop policy if exists "costumers_select_authenticated" on public.costumers;
create policy "costumers_select_authenticated" on public.costumers
  for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or costumer_id = public.current_costumer_id()
  );
