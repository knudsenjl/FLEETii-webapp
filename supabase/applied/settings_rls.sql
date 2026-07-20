-- RLS policy for settings — same gap as vehicle_profiles had: RLS enabled
-- with no SELECT policy means every read returns 200 with an empty array
-- rather than an error, which is exactly the symptom that led here (the
-- Anvendelse dropdown on ReservationPage came back empty, 200 [] for the
-- settings request).
--
-- Permissive "any authenticated user may read" policy — settings are
-- app-wide config (dropdown option lists etc.), not department-scoped or
-- sensitive, so this mirrors vehicle_signals_select_authenticated /
-- vehicle_profiles_select_authenticated.
--
-- Safe to run regardless of settings' current RLS state.

alter table public.settings enable row level security;

drop policy if exists "settings_select_authenticated" on public.settings;
create policy "settings_select_authenticated"
  on public.settings for select
  to authenticated
  using (true);
