-- Adds a "user_departments" join table modeling which departments a user is
-- allowed to switch into (admin-granted, all-or-a-subset of the user's own
-- costumer's departments) — distinct from user_profiles.department_id,
-- which keeps meaning exactly what it means today: the user's CURRENTLY
-- ACTIVE department, used by every existing RLS policy/query unchanged.
-- "Skift afdeling" (the not-yet-implemented header button, see
-- PageHeader.tsx) will read a user's rows here to offer a switch, then
-- update user_profiles.department_id to the chosen one.
--
-- Safe to re-run: guarded at each step (table/constraint/policy existence
-- checked before creating).

-- 1. The join table itself. No ON DELETE CASCADE — matching every other FK
--    in this schema (bookings, settings, departments, user_profiles all use
--    plain foreign keys with no cascade), so deleting a user or department
--    fails loudly if grants still reference it, rather than silently
--    wiping rows.
create table if not exists public.user_departments (
  user_id uuid not null references public.user_profiles (user_id),
  department_id uuid not null references public.departments (department_id),
  created_at timestamptz not null default now(),
  primary key (user_id, department_id)
);

-- 2. Backfill: every user's current department_id becomes their first grant,
--    so the invariant "your active department is always one you have access
--    to" holds from the start.
insert into public.user_departments (user_id, department_id)
select user_id, department_id
from public.user_profiles
where department_id is not null
on conflict (user_id, department_id) do nothing;

-- 3. Helper: the logged-in user's own costumer_id, mirroring
--    current_department_id()'s pattern (see rls_policies.sql) — used below
--    to scope admin grant/revoke to their own costumer's departments/users
--    only, matching the actual ask ("admin can give access to all/a subset
--    of the costumer's departments" — not just their own single department).
create or replace function public.current_costumer_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select costumer_id from public.user_profiles where user_id = auth.uid();
$$;

-- 4. RLS.
alter table public.user_departments enable row level security;

-- A user may read their own grants (to populate "Skift afdeling"); an admin
-- may read grants for any department in their own costumer (to manage
-- other users' access).
drop policy if exists "user_departments_select_own_or_admin_costumer" on public.user_departments;
create policy "user_departments_select_own_or_admin_costumer" on public.user_departments
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      public.is_admin()
      and exists (
        select 1 from public.departments d
        where d.department_id = user_departments.department_id
          and d.costumer_id = public.current_costumer_id()
      )
    )
  );

-- An admin may grant/revoke access, but only for a department in their own
-- costumer AND a user who is also in their own costumer (can't reach across
-- into a different costumer's users or departments).
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
    and exists (
      select 1 from public.user_profiles up
      where up.user_id = user_departments.user_id
        and up.costumer_id = public.current_costumer_id()
    )
  );

drop policy if exists "user_departments_delete_admin_own_costumer" on public.user_departments;
create policy "user_departments_delete_admin_own_costumer" on public.user_departments
  for delete
  to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.departments d
      where d.department_id = user_departments.department_id
        and d.costumer_id = public.current_costumer_id()
    )
  );
