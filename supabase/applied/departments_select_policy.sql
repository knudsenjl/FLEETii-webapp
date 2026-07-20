-- Lets any authenticated user read public.departments (id, department_name),
-- so UserDetailsPage.tsx can populate the "Afdeling" dropdown with the real
-- list of department names instead of a free-text field. Department names
-- aren't sensitive, so this is open to every authenticated user rather than
-- admin-only.
--
-- Includes an explicit GRANT SELECT alongside the RLS policy — see
-- supabase/user_profiles_grant_delete.sql's header for why: a table can have
-- a correct RLS policy and still throw "permission denied for table X" if
-- the base Postgres GRANT is missing, so both are set here rather than
-- assuming the RLS policy alone is enough.
--
-- Safe to re-run: GRANT is idempotent, policy is dropped before recreated.

grant select on public.departments to authenticated;

alter table public.departments enable row level security;

drop policy if exists "departments_select_authenticated" on public.departments;
create policy "departments_select_authenticated" on public.departments
  for select
  to authenticated
  using (true);
