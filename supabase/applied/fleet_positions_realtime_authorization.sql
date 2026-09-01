-- Restricts who may RECEIVE the "fleet-positions:<costumerId>" /
-- "fleet-positions:fleetii-admin" Realtime Broadcast channels (see
-- VehicleContext.tsx / 2hire-webhook.mts) to members of that costumer, or a
-- FLEETii admin. Before this, the channel was a single global
-- "fleet-positions" name with no authorization at all -- the channel name
-- was the only "secret", so any authenticated user could open it directly
-- and receive every costumer's live GPS stream, same class of leak as the
-- vehicle_profiles/vehicle_signals table reads fixed alongside this (see
-- vehicle_profiles_signals_departments_scope_costumer.sql).
--
-- select-only: a client here only ever RECEIVES broadcasts. They're sent by
-- 2hire-webhook.mts via the service-role client, which connects to Realtime
-- as the admin role and isn't subject to this policy at all -- no insert
-- policy needed.
--
-- REQUIRES a one-time manual step this migration cannot perform: disable
-- "Allow public access" in Supabase Dashboard -> Project -> Realtime ->
-- Settings. Until that's off, Realtime Authorization is not enforced at all
-- and any channel (private or not) stays openly joinable regardless of this
-- policy.
--
-- Applied to FLEETii-DB-Staging on 2026-08-30; production had drifted
-- (this policy was missing there, which silently blocked the fleet-map
-- Live toggle from ever receiving a broadcast on app.fleetii.dk -- no
-- error surfaced anywhere, since VehicleContext.tsx's .subscribe() call
-- doesn't check its status) until also applied to FLEETii-DB-Production
-- on 2026-09-01. Safe to re-run: policy dropped before recreated.

drop policy if exists "fleet_positions_receive_own_costumer" on "realtime"."messages";
create policy "fleet_positions_receive_own_costumer"
  on "realtime"."messages"
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (
      (select realtime.topic()) = 'fleet-positions:' || public.current_costumer_id()::text
      or (
        (select realtime.topic()) = 'fleet-positions:fleetii-admin'
        and public.is_fleetii_admin()
      )
    )
  );
