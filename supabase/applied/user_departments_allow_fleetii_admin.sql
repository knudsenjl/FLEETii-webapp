-- Lets a "FLEETii admin" write/read user_departments rows for ANY
-- costumer/department (no costumer-match restriction), same reasoning as
-- department_settings_allow_fleetii_admin.sql — needed so the "Afdeling(er)"
-- checkbox table on UserDetailsPage (just extended to also render for role
-- "FLEETii admin", not just "admin") actually persists when a FLEETii admin
-- is the one creating/editing the account.
--
-- is_admin() requires role = 'admin' exactly (see its definition) — a
-- "FLEETii admin" never satisfies it, regardless of whether their own
-- profile happens to carry a costumer_id/department_id (some do, for
-- internal test accounts). Narrow, targeted fix rather than widening
-- is_admin() itself, exactly like the department_settings precedent: only
-- the FLEETii-admin branch is new, and it deliberately skips the
-- costumer-match checks (current_costumer_id()/user_belongs_to_costumer)
-- entirely, since a FLEETii admin isn't scoped to one costumer. A regular
-- admin keeps the exact same restriction as before.
--
-- Safe to re-run: policies dropped before recreated.

drop policy if exists "user_departments_select_own_or_admin_costumer" on public.user_departments;
create policy "user_departments_select_own_or_admin_costumer" on public.user_departments
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_fleetii_admin()
    or (
      public.is_admin()
      and exists (
        select 1 from public.departments d
        where d.department_id = user_departments.department_id
          and d.costumer_id = public.current_costumer_id()
      )
    )
  );

drop policy if exists "user_departments_insert_admin_own_costumer" on public.user_departments;
create policy "user_departments_insert_admin_own_costumer" on public.user_departments
  for insert
  to authenticated
  with check (
    public.is_fleetii_admin()
    or (
      public.is_admin()
      and exists (
        select 1 from public.departments d
        where d.department_id = user_departments.department_id
          and d.costumer_id = public.current_costumer_id()
      )
      and public.user_belongs_to_costumer(user_id, public.current_costumer_id())
    )
  );

drop policy if exists "user_departments_delete_admin_own_costumer" on public.user_departments;
create policy "user_departments_delete_admin_own_costumer" on public.user_departments
  for delete
  to authenticated
  using (
    public.is_fleetii_admin()
    or (
      public.is_admin()
      and exists (
        select 1 from public.departments d
        where d.department_id = user_departments.department_id
          and d.costumer_id = public.current_costumer_id()
      )
    )
  );
