-- Restricts writes to the three Tillad_* permission flags in user_settings
-- to admins only (of the target user's own department) — a regular user
-- must NOT be able to grant themselves a permission their department admin
-- denied by writing their own user_settings override (the self-escalation
-- risk flagged this session, same class of bug as the legacy public-scoped
-- user_profiles policy fixed earlier). "Anvendelse" (and any other
-- non-Tillad_* setting) is untouched — a user still manages their own
-- personal list there, which is harmless.
--
-- No admin-facing UI writes a per-user Tillad_* override today
-- (SettingsUserPage.tsx shows RettighederSettings readOnly instead) — this
-- policy is pure defense-in-depth for now, so a future direct-API call or a
-- future "edit this user's overrides" admin page can't bypass the
-- restriction either.
--
-- Safe to re-run: policies are dropped before recreated.

drop policy if exists "user_settings_insert_own" on public.user_settings;
drop policy if exists "user_settings_insert_own_or_admin" on public.user_settings;
create policy "user_settings_insert_own_or_admin" on public.user_settings
  for insert
  to authenticated
  with check (
    (
      name not in ('Tillad_ny_reservation', 'Tillad_rediger_reservation', 'Tillad_slet_reservation')
      and user_id = auth.uid()
    )
    or (
      name in ('Tillad_ny_reservation', 'Tillad_rediger_reservation', 'Tillad_slet_reservation')
      and public.is_admin()
      and exists (
        select 1 from public.user_profiles up
        where up.user_id = user_settings.user_id
          and up.department_id = public.current_department_id()
      )
    )
  );

drop policy if exists "user_settings_update_own" on public.user_settings;
drop policy if exists "user_settings_update_own_or_admin" on public.user_settings;
create policy "user_settings_update_own_or_admin" on public.user_settings
  for update
  to authenticated
  using (
    (
      name not in ('Tillad_ny_reservation', 'Tillad_rediger_reservation', 'Tillad_slet_reservation')
      and user_id = auth.uid()
    )
    or (
      name in ('Tillad_ny_reservation', 'Tillad_rediger_reservation', 'Tillad_slet_reservation')
      and public.is_admin()
      and exists (
        select 1 from public.user_profiles up
        where up.user_id = user_settings.user_id
          and up.department_id = public.current_department_id()
      )
    )
  )
  with check (
    (
      name not in ('Tillad_ny_reservation', 'Tillad_rediger_reservation', 'Tillad_slet_reservation')
      and user_id = auth.uid()
    )
    or (
      name in ('Tillad_ny_reservation', 'Tillad_rediger_reservation', 'Tillad_slet_reservation')
      and public.is_admin()
      and exists (
        select 1 from public.user_profiles up
        where up.user_id = user_settings.user_id
          and up.department_id = public.current_department_id()
      )
    )
  );
