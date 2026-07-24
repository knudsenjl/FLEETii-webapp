-- Guards the invariant just established (backfill_and_assign_vehicles_to_alle_koretojer.sql
-- — every vehicle belongs to its costumer's "Alle køretøjer" department by
-- definition) against being undone via DELETE: narrows the existing
-- vehicle_departments delete policy (vehicle_departments_write_policies.sql)
-- so an admin may remove a vehicle from any of their own costumer's
-- departments EXCEPT "Alle køretøjer" itself.
--
-- RLS-style guard: a DELETE targeting that row now silently affects 0 rows
-- rather than erroring — the app-side check (HandleVehiclePage.tsx's
-- checkbox table disables/forces-checked that one row) is what actually
-- stops an admin from attempting it in the first place; this is the
-- server-side backstop, matching every other guard-by-omission in this
-- schema's RLS.
--
-- Safe to re-run: policy dropped before recreated.

drop policy if exists "vehicle_departments_delete_admin_own_costumer" on public.vehicle_departments;
create policy "vehicle_departments_delete_admin_own_costumer" on public.vehicle_departments
  for delete
  to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.departments d
      where d.department_id = vehicle_departments.department_id
        and d.costumer_id = public.current_costumer_id()
        and d.name <> 'Alle køretøjer'
    )
  );
