-- Broadens departments_update_fleetii_admin (departments_update_policy.sql)
-- so a plain "admin" can also rename departments belonging to their OWN
-- costumer — needed for AdminFrontpage.tsx's new "Administration af
-- afdelinger" button, which sends a regular admin straight to
-- EditDepartmentsPage.tsx (bypassing DepartmentDetailsPage, which stays
-- FLEETii-admin-only). Same "FLEETii admin: any costumer, admin: own
-- costumer_id only" shape as costumer_orders_select_delete_policies.sql.
--
-- Safe to re-run: policy is dropped before recreated.

drop policy if exists "departments_update_fleetii_admin" on public.departments;
create policy "departments_update_admin_own_costumer" on public.departments
  for update
  to authenticated
  using (
    public.is_fleetii_admin()
    or (public.is_admin() and costumer_id = public.current_costumer_id())
  )
  with check (
    public.is_fleetii_admin()
    or (public.is_admin() and costumer_id = public.current_costumer_id())
  );
