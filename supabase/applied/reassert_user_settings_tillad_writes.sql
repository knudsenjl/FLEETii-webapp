-- Defensive re-assertion, per code review: user_settings_restrict_tillad_
-- writes.sql and add_tillad_reservation_uden_sluttidspunkt.sql both fully
-- redefine the same-named policies, and their actual apply order against
-- THIS live database can't be verified from git history alone (both are
-- idempotent drop-then-create, so whichever ran last on this specific
-- database wins). Re-running the final, complete 4-flag version here
-- removes any doubt regardless of history — a no-op if the DB already has
-- it, a fix if it somehow doesn't (which would otherwise let a regular user
-- grant themselves Tillad_reservation_uden_sluttidspunkt via their own
-- user_settings upsert).
--
-- Content identical to add_tillad_reservation_uden_sluttidspunkt.sql — see
-- that file for the full reasoning.
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
