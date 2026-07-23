-- Relaxes departments_protect_default_delete.sql's guard: "Alle køretøjer"
-- may now be deleted, but only once it's the LAST remaining department for
-- its costumer — still blocked while any other department exists. This
-- supports "Slet kunde" cascading (delete the sole leftover default
-- department, then the costumer itself, rather than hitting
-- departments_costumer_id_fkey's foreign-key-violation error) while still
-- protecting the placeholder from casual deletion via "Slet afdeling"
-- while the costumer has real departments alongside it.
--
-- Safe to re-run: policy is dropped before recreated.

drop policy if exists "departments_delete_fleetii_admin" on public.departments;
create policy "departments_delete_fleetii_admin" on public.departments
  for delete
  to authenticated
  using (
    public.is_fleetii_admin()
    and (
      name <> 'Alle køretøjer'
      or not exists (
        select 1 from public.departments other
        where other.costumer_id = departments.costumer_id
          and other.department_id <> departments.department_id
      )
    )
  );
