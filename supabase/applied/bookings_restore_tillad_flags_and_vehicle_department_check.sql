-- Fixes two gaps in bookings' INSERT/UPDATE/DELETE RLS policies, found in
-- the 2026-09-24 code review:
--
-- 1. The Tillad_* permission flags were no longer enforced. They were
--    added by bookings_enforce_tillad_flags.sql (2026-07-24), but
--    bookings_allow_fleetii_admin.sql and bookings_insert_allow_fleetii_admin.sql
--    (2026-08-03) recreated the same three policies to add the FLEETii-admin
--    (now sysadm) bypass and silently dropped the flag checks, so a regular
--    user denied e.g. Tillad_ny_reservation could still book via a direct
--    Supabase call from the browser console.
--
-- 2. Nothing checked that the booked VEHICLE belongs to the booking's
--    department. A regular user could insert a booking in their own
--    department for ANY vehicle_id — another department's, or even another
--    costumer's (confirmed on staging in a rolled-back transaction) — and
--    set-vehicle-lock.mts would then authorize a real 2hire unlock off that
--    booking. Every existing booking already satisfies this (verified on
--    both staging and production before applying), so the app's own
--    ReservationPage/AvailablePage flow is unaffected.
--
-- Same flag semantics as before (see is_setting_tilladt in
-- bookings_enforce_tillad_flags.sql and src/lib/settings.ts's
-- isSettingTilladt): admins bypass the Tillad_* flags; sysadm bypasses
-- everything, same as the 2026-08-03 policies.
--
-- Safe to re-run: policies dropped before recreated.

drop policy if exists "bookings_insert_own_department" on public.bookings;
create policy "bookings_insert_own_department" on public.bookings
  for insert
  to authenticated
  with check (
    public.is_sysadm()
    or (
      department_id = public.current_department_id()
      and exists (
        select 1 from public.vehicle_departments vd
        where vd.vehicle_id = bookings.vehicle_id and vd.department_id = bookings.department_id
      )
      and (
        public.is_admin()
        or (
          user_id = auth.uid()
          and public.is_setting_tilladt('Tillad_ny_reservation', user_id, department_id)
          and (
            "end" is not null
            or public.is_setting_tilladt('Tillad_reservation_uden_sluttidspunkt', user_id, department_id)
          )
        )
      )
    )
  );

drop policy if exists "bookings_update_own_or_department_admin" on public.bookings;
create policy "bookings_update_own_or_department_admin" on public.bookings
  for update
  to authenticated
  using (
    public.is_sysadm()
    or (public.is_admin() and department_id = public.current_department_id())
    or (
      user_id = auth.uid()
      and public.is_setting_tilladt('Tillad_rediger_reservation', user_id, department_id)
    )
  )
  with check (
    public.is_sysadm()
    or (
      department_id = public.current_department_id()
      and exists (
        select 1 from public.vehicle_departments vd
        where vd.vehicle_id = bookings.vehicle_id and vd.department_id = bookings.department_id
      )
      and (
        public.is_admin()
        or (
          user_id = auth.uid()
          and public.is_setting_tilladt('Tillad_rediger_reservation', user_id, department_id)
          and (
            "end" is not null
            or public.is_setting_tilladt('Tillad_reservation_uden_sluttidspunkt', user_id, department_id)
          )
        )
      )
    )
  );

drop policy if exists "bookings_delete_own_or_department_admin" on public.bookings;
create policy "bookings_delete_own_or_department_admin" on public.bookings
  for delete
  to authenticated
  using (
    public.is_sysadm()
    or (public.is_admin() and department_id = public.current_department_id())
    or (
      user_id = auth.uid()
      and public.is_setting_tilladt('Tillad_slet_reservation', user_id, department_id)
    )
  );
