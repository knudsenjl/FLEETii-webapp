-- Fixes "new row violates row-level security policy for table
-- user_departments" when UserDetailsPage.tsx seeds grants for a
-- brand-new user right after creation.
--
-- Root cause: user_departments_insert_admin_own_costumer
-- (user_departments_table.sql) checks the target user's costumer_id via a
-- raw `exists (select 1 from public.user_profiles up where ...)` subquery.
-- Postgres RLS subqueries referencing another table are subject to THAT
-- table's own RLS too — and user_profiles' own SELECT policy
-- (user_profiles_select_admin_own_department, see rls_policies.sql) only
-- lets an admin see rows in their own CURRENTLY ACTIVE department, not
-- their whole costumer. So the moment a new user's home department isn't
-- the admin's own current department, the subquery can't see that row at
-- all, and the check silently evaluates to false.
--
-- Fix: wrap the check in a SECURITY DEFINER helper (same pattern as
-- is_admin()/current_costumer_id() in rls_policies.sql), which bypasses
-- user_profiles' RLS for this one specific, narrow check — mirroring how
-- current_costumer_id() itself already reads user_profiles without being
-- blocked by that same policy.
--
-- Safe to re-run: function is CREATE OR REPLACE, policy dropped before
-- recreated.

create or replace function public.user_belongs_to_costumer(target_user_id uuid, target_costumer_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = target_user_id and costumer_id = target_costumer_id
  );
$$;

drop policy if exists "user_departments_insert_admin_own_costumer" on public.user_departments;
create policy "user_departments_insert_admin_own_costumer" on public.user_departments
  for insert
  to authenticated
  with check (
    public.is_admin()
    and exists (
      select 1 from public.departments d
      where d.department_id = user_departments.department_id
        and d.costumer_id = public.current_costumer_id()
    )
    and public.user_belongs_to_costumer(user_departments.user_id, public.current_costumer_id())
  );
