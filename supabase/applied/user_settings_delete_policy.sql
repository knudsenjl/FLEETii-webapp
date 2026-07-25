-- Adds the missing DELETE grant/policy on user_settings — needed for
-- RettighederSettings.tsx's new "Nulstil" button (clears a user's own
-- Tillad_* override back to "unset" so the department default applies
-- again). user_settings previously only had SELECT/INSERT/UPDATE (see
-- settings_write_policies.sql / user_settings_restrict_tillad_writes.sql) —
-- without this, the DELETE call would fail outright ("permission denied for
-- table user_settings", not even reaching RLS, since the base GRANT itself
-- was missing).
--
-- Scoped identically to the existing Tillad_* INSERT/UPDATE policies (see
-- reassert_user_settings_tillad_writes.sql): a regular user may delete their
-- own non-Tillad_* rows (harmless self-management, e.g. their personal
-- Anvendelse additions), but NOT their own Tillad_* override — only an admin
-- may, and only for a user in the admin's own department. Prevents the same
-- self-escalation this app already guards against for writing these flags:
-- a user clearing their own restrictive override would functionally be
-- self-escalation, identical in effect to setting it to true directly.
--
-- Safe to re-run: GRANT is idempotent, policy is dropped before recreated.

grant delete on public.user_settings to authenticated;

drop policy if exists "user_settings_delete_own_or_admin" on public.user_settings;
create policy "user_settings_delete_own_or_admin" on public.user_settings
  for delete
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
  );
