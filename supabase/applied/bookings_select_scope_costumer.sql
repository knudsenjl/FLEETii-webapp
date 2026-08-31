-- Scopes bookings SELECT to the caller's own costumer (tenant isolation) --
-- rls_policies.sql's original policy was `using (true)` for any
-- authenticated user, deliberately kept broad because AvailablePage
-- genuinely needs to see OTHER departments'/users' booking windows to
-- compute vehicle availability. That reasoning holds within one costumer,
-- but the policy never actually stopped at the costumer boundary -- any
-- authenticated user of ANY costumer could read every OTHER costumer's
-- booking records (vehicle_id, start/end, department_id, usage, user_id)
-- via a direct Supabase REST call, same class of leak as the
-- vehicle_profiles/vehicle_signals/vehicle_departments reads fixed earlier
-- (see vehicle_profiles_signals_departments_scope_costumer.sql) and the
-- bookings table this session already scoped INSERT/UPDATE/DELETE to (see
-- bookings_allow_fleetii_admin.sql/rls_policies.sql) but never SELECT.
--
-- Fixed the same way: public.is_fleetii_admin() (platform-wide, unscoped)
-- or an EXISTS join to vehicle_profiles.costumer_id via
-- public.current_costumer_id() -- bookings has no costumer_id column of its
-- own, and vehicle_id is NOT NULL, so this join always has something to
-- match against. Deliberately still open ACROSS departments within that one
-- costumer (no department_id check) -- AvailablePage's own cross-department
-- read stays exactly as legitimate as rls_policies.sql's original comment
-- describes; only the CUSTOMER boundary was the actual gap.
--
-- Applied to FLEETii-DB-Staging on 2026-08-31. Safe to re-run: policy
-- dropped before recreated.

drop policy if exists "bookings_select_authenticated" on public.bookings;
create policy "bookings_select_authenticated" on public.bookings
  for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or exists (
      select 1 from public.vehicle_profiles vp
      where vp.vehicle_id = bookings.vehicle_id
        and vp.costumer_id = public.current_costumer_id()
    )
  );
