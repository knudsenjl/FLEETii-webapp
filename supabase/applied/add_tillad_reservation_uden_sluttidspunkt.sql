-- Adds the new "Tillad_reservation_uden_sluttidspunkt" permission flag
-- (gates the "Ingen slutdato" / open-ended-reservation toggle on
-- ReservationPage.tsx) to the same admin-only write restriction the other
-- three Tillad_* flags already have on user_settings (see
-- user_settings_restrict_tillad_writes.sql) — otherwise a regular user could
-- grant themselves this permission via their own user_settings override,
-- the same self-escalation risk fixed for the original three flags.
--
-- department_settings needs no change: its insert/update policies (see
-- settings_write_policies.sql) already require is_admin() for every setting
-- name, this new one included.
--
-- Safe to re-run: policies are dropped before recreated.

drop policy if exists "user_settings_insert_own_or_admin" on public.user_settings;
create policy "user_settings_insert_own_or_admin" on public.user_settings
  for insert
  to authenticated
  with check (
    (
      name not in (
        'Tillad_ny_reservation',
        'Tillad_rediger_reservation',
        'Tillad_slet_reservation',
        'Tillad_reservation_uden_sluttidspunkt'
      )
      and user_id = auth.uid()
    )
    or (
      name in (
        'Tillad_ny_reservation',
        'Tillad_rediger_reservation',
        'Tillad_slet_reservation',
        'Tillad_reservation_uden_sluttidspunkt'
      )
      and public.is_admin()
      and exists (
        select 1 from public.user_profiles up
        where up.user_id = user_settings.user_id
          and up.department_id = public.current_department_id()
      )
    )
  );

drop policy if exists "user_settings_update_own_or_admin" on public.user_settings;
create policy "user_settings_update_own_or_admin" on public.user_settings
  for update
  to authenticated
  using (
    (
      name not in (
        'Tillad_ny_reservation',
        'Tillad_rediger_reservation',
        'Tillad_slet_reservation',
        'Tillad_reservation_uden_sluttidspunkt'
      )
      and user_id = auth.uid()
    )
    or (
      name in (
        'Tillad_ny_reservation',
        'Tillad_rediger_reservation',
        'Tillad_slet_reservation',
        'Tillad_reservation_uden_sluttidspunkt'
      )
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
      name not in (
        'Tillad_ny_reservation',
        'Tillad_rediger_reservation',
        'Tillad_slet_reservation',
        'Tillad_reservation_uden_sluttidspunkt'
      )
      and user_id = auth.uid()
    )
    or (
      name in (
        'Tillad_ny_reservation',
        'Tillad_rediger_reservation',
        'Tillad_slet_reservation',
        'Tillad_reservation_uden_sluttidspunkt'
      )
      and public.is_admin()
      and exists (
        select 1 from public.user_profiles up
        where up.user_id = user_settings.user_id
          and up.department_id = public.current_department_id()
      )
    )
  );
