-- Lets an admin manage their own department's Anvendelse list
-- (department_settings) and a regular user manage their own override
-- (user_settings) — both tables only had a SELECT policy until now (see
-- split_settings_into_user_and_department.sql). AnvendelseSettings.tsx's
-- upsert (insert ... on conflict do update) needs both an INSERT and an
-- UPDATE policy, since Postgres evaluates the ON CONFLICT path against the
-- UPDATE policy separately from the initial INSERT attempt.
--
-- department_settings is scoped to is_admin() (role = 'admin' specifically)
-- + current_department_id(), matching who can actually reach
-- /settings-admin (ProtectedRoute requireRole="admin", an exact match —
-- "FLEETii admin" has its own separate settings page, untouched here).
-- user_settings is scoped to the row's own user_id = auth.uid(), no role
-- check needed — any authenticated user manages only their own row.
--
-- Safe to re-run: GRANTs are idempotent, policies are dropped before
-- recreated.

grant insert, update on public.department_settings to authenticated;
grant insert, update on public.user_settings to authenticated;

drop policy if exists "department_settings_insert_admin_own_department" on public.department_settings;
create policy "department_settings_insert_admin_own_department" on public.department_settings
  for insert
  to authenticated
  with check (public.is_admin() and department_id = public.current_department_id());

drop policy if exists "department_settings_update_admin_own_department" on public.department_settings;
create policy "department_settings_update_admin_own_department" on public.department_settings
  for update
  to authenticated
  using (public.is_admin() and department_id = public.current_department_id())
  with check (public.is_admin() and department_id = public.current_department_id());

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
