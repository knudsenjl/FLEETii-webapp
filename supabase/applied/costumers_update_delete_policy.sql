-- Lets a "FLEETii admin" edit/delete costumers (CostumerDetailsPage's new
-- "Rediger kunde"/"Slet kunde" buttons) — costumers only had SELECT/INSERT
-- policies until now (costumers_select_policy.sql,
-- costumers_insert_policy.sql). Base table grants for UPDATE/DELETE
-- already exist for "authenticated" (confirmed via role_table_grants), so
-- only the RLS policies are missing here.
--
-- No ON DELETE CASCADE exists from departments.costumer_id (matches every
-- other FK in this schema) — deleting a costumer that still has
-- departments will fail with a foreign-key-violation error surfaced as-is
-- to the admin, same as this app's other delete flows (e.g.
-- VehicleDetailsPage's) don't attempt any cascading cleanup either.
--
-- Safe to re-run: policies are dropped before recreated.

drop policy if exists "costumers_update_fleetii_admin" on public.costumers;
create policy "costumers_update_fleetii_admin" on public.costumers
  for update
  to authenticated
  using (public.is_fleetii_admin())
  with check (public.is_fleetii_admin());

drop policy if exists "costumers_delete_fleetii_admin" on public.costumers;
create policy "costumers_delete_fleetii_admin" on public.costumers
  for delete
  to authenticated
  using (public.is_fleetii_admin());
