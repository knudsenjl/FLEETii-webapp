-- Refuses to delete a costumer's default "Alle køretøjer" department (the
-- one costumers_create_default_department auto-creates for every new
-- costumer — see departments_unique_per_costumer_and_auto_create.sql).
-- Enforced at the RLS layer (not just the client's pre-check/popup in
-- CostumerDetailsPage.tsx), since a client-only guard is trivially
-- bypassed by calling the REST API directly.
--
-- Note for app code: RLS silently returns "0 rows affected" for a delete a
-- policy blocks — it does NOT throw an error on its own (the same gotcha
-- this session hit repeatedly with SELECT policies, e.g.
-- costumers_select_policy.sql). handleDeleteDepartment must check that a
-- row actually came back (e.g. via .delete().select()) and show its own
-- error if not, rather than assuming success just because Supabase
-- returned no error.
--
-- Safe to re-run: policy is dropped before recreated.

drop policy if exists "departments_delete_fleetii_admin" on public.departments;
create policy "departments_delete_fleetii_admin" on public.departments
  for delete
  to authenticated
  using (public.is_fleetii_admin() and name <> 'Alle køretøjer');
