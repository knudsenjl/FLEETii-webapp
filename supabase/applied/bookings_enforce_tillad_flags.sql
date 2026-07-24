-- Closes a gap found in code review: the four "Tillad_*" Rettigheder
-- permission flags (Tillad_ny_reservation, Tillad_rediger_reservation,
-- Tillad_slet_reservation, Tillad_reservation_uden_sluttidspunkt — see
-- rename_bruger_to_tillad_and_add_bool.sql/RettighederSettings.tsx) were
-- only ever enforced by hiding buttons in the UI (BookingsPage.tsx/
-- BookingDetailsPage.tsx/ReservationPage.tsx's isSettingTilladt calls) —
-- none of bookings' INSERT/UPDATE/DELETE RLS policies referenced them, so a
-- user denied one of these could still perform the action via a direct
-- Supabase call from the browser console.
--
-- Adds public.is_setting_tilladt(setting_name, target_user_id,
-- target_department_id), a SQL mirror of src/lib/settings.ts's
-- isSettingTilladt(): if target_user_id has its own row in user_settings for
-- setting_name, that row's value_bool decides it outright (even if false or
-- null) regardless of target_department_id; otherwise falls back to
-- department_settings' row; false if neither exists. Used with the row's OWN
-- user_id/department_id in each policy below — for a non-admin, RLS already
-- forces those to equal auth.uid()/current_department_id(), so this is
-- equivalent to checking the CALLER's own flag, matching the client-side
-- isSettingTilladt(name, profile?.user_id, afdelingId) calls exactly.
--
-- Admins bypass all four checks (matching the client-side "isAdmin ||
-- userMayXxx" pattern everywhere these flags are read) — these flags exist
-- to restrict a REGULAR user's own actions, never an admin's.
--
-- Safe to re-run: function replaced, policies dropped before recreated.

create or replace function public.is_setting_tilladt(
  setting_name text,
  target_user_id uuid,
  target_department_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when exists (
      select 1 from public.user_settings
      where name = setting_name and user_id = target_user_id
    ) then coalesce(
      (select value_bool from public.user_settings
       where name = setting_name and user_id = target_user_id),
      false
    )
    else coalesce(
      (select value_bool from public.department_settings
       where name = setting_name and department_id = target_department_id),
      false
    )
  end;
$$;

-- Revokes from anon/authenticated explicitly, not just "from public" — this
-- project has a default-privileges rule that grants anon/authenticated
-- execute on new public-schema functions DIRECTLY (not via the PUBLIC
-- pseudo-role), so "revoke ... from public" alone leaves anon still able to
-- call this. Still granted to authenticated afterward: RLS policies are
-- evaluated as the querying role, so authenticated needs execute for the
-- bookings policies above to actually work for logged-in users.
revoke execute on function public.is_setting_tilladt(text, uuid, uuid) from anon, authenticated;
grant execute on function public.is_setting_tilladt(text, uuid, uuid) to authenticated;

drop policy if exists "bookings_insert_own_department" on public.bookings;
create policy "bookings_insert_own_department" on public.bookings
  for insert
  to authenticated
  with check (
    department_id = public.current_department_id()
    and (public.is_admin() or user_id = auth.uid())
    and (
      public.is_admin()
      or public.is_setting_tilladt('Tillad_ny_reservation', user_id, department_id)
    )
    and (
      "end" is not null
      or public.is_admin()
      or public.is_setting_tilladt('Tillad_reservation_uden_sluttidspunkt', user_id, department_id)
    )
  );

drop policy if exists "bookings_update_own_or_department_admin" on public.bookings;
create policy "bookings_update_own_or_department_admin" on public.bookings
  for update
  to authenticated
  using (
    (
      user_id = auth.uid()
      and public.is_setting_tilladt('Tillad_rediger_reservation', user_id, department_id)
    )
    or (public.is_admin() and department_id = public.current_department_id())
  )
  with check (
    department_id = public.current_department_id()
    and (public.is_admin() or user_id = auth.uid())
    and (
      public.is_admin()
      or public.is_setting_tilladt('Tillad_rediger_reservation', user_id, department_id)
    )
    and (
      "end" is not null
      or public.is_admin()
      or public.is_setting_tilladt('Tillad_reservation_uden_sluttidspunkt', user_id, department_id)
    )
  );

drop policy if exists "bookings_delete_own_or_department_admin" on public.bookings;
create policy "bookings_delete_own_or_department_admin" on public.bookings
  for delete
  to authenticated
  using (
    (
      user_id = auth.uid()
      and public.is_setting_tilladt('Tillad_slet_reservation', user_id, department_id)
    )
    or (public.is_admin() and department_id = public.current_department_id())
  );
