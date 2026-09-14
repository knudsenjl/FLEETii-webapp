-- Widens user_settings' own SELECT policy to match user_profiles' own
-- precedent (user_profiles_select_admin_own_department, despite its name,
-- actually already checks costumer_id = current_costumer_id(), not
-- department — see its live qual). user_settings' SELECT policy never got
-- the same treatment: an admin could only read a user_settings row belonging
-- to a user in the admin's own CURRENTLY-ACTIVE department, not their whole
-- costumer — invisible until now because nothing before this let an admin
-- view another user's Standard settings/Anvendelser at all (UserDetailsPage
-- only ever wrote user_settings' Tillad_* rows, via the admin-write path
-- below, which stays department-scoped on purpose and is UNTOUCHED by this
-- migration). Surfaced while unifying "/settings-user" into
-- UserDetailsPage.tsx, which adds a real cross-department admin-view use
-- case for the first time (see that component's own doc comment) — without
-- this, an admin viewing a user in some OTHER department under their own
-- costumer would see that section come back empty/erroring instead of the
-- real data.
--
-- Only SELECT changes here. INSERT/UPDATE/DELETE (the Tillad_* admin-write
-- path) stay exactly as they are — still scoped to current_department_id(),
-- not costumer-wide — since this unification only needs admin VIEW, not
-- write, of another user's personal Standard settings/Anvendelser.
--
-- Safe to re-run: policy dropped before recreated.

drop policy if exists user_settings_select_own_or_admin_own_department on public.user_settings;

create policy user_settings_select_own_or_admin_own_department
  on public.user_settings
  for select
  using (
    user_id = auth.uid()
    or is_sysadm()
    or (
      is_admin()
      and exists (
        select 1
        from public.user_profiles up
        where up.user_id = user_settings.user_id
          and up.costumer_id = current_costumer_id()
      )
    )
  );
