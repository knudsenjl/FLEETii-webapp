-- Closes a cross-tenant read gap found in code review: both
-- department_settings_select_authenticated (split_settings_into_user_and_
-- department.sql) and user_settings_select_authenticated (inherited as-is
-- from the original settings_rls.sql, just renamed) were `using (true)` —
-- letting ANY authenticated user read ANY other department's or user's
-- settings rows (Tillad_* permission flags, Standard_* durations, Anvendelse
-- lists) by simply querying with an arbitrary department_id/user_id, since
-- the client (AnvendelseSettings.tsx/StandardSettings.tsx/
-- RettighederSettings.tsx) picks the id and nothing server-side restricted
-- it.
--
-- department_settings: every read in this app is scoped to the CALLER's own
-- current department (SettingsAdminPage.tsx/SettingsUserPage.tsx both pass
-- afdelingId — never another department's id) — tightened to exactly that,
-- plus an is_fleetii_admin() bypass for support/management.
--
-- user_settings: a user always needs to read their OWN row; an admin
-- additionally needs to read a row for a user THEY manage (RettighederSettings
-- rendered on UserDetailsPage.tsx for the user being edited, not the admin's
-- own row) — scoped to the admin's own department, matching this app's
-- existing tightest precedent for "an admin acting on another user"
-- (user_profiles_select_admin_own_department in rls_policies.sql), plus the
-- same is_fleetii_admin() bypass.
--
-- Safe to re-run: policies dropped before recreated.

drop policy if exists "department_settings_select_authenticated" on public.department_settings;
create policy "department_settings_select_own_department"
  on public.department_settings for select
  to authenticated
  using (
    department_id = public.current_department_id()
    or public.is_fleetii_admin()
  );

drop policy if exists "user_settings_select_authenticated" on public.user_settings;
create policy "user_settings_select_own_or_admin_own_department"
  on public.user_settings for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      public.is_admin()
      and exists (
        select 1 from public.user_profiles up
        where up.user_id = user_settings.user_id
          and up.department_id = public.current_department_id()
      )
    )
    or public.is_fleetii_admin()
  );
