-- Renames the "FLEETii admin" role to "sysadm" at the database level:
-- the stored user_profiles.role value, the is_fleetii_admin() function
-- (-> is_sysadm()), the 5 RLS policies whose own NAME contained
-- "fleetii_admin" (-> "sysadm"), the qual/with_check body of the other 24
-- policies that call the function (name unchanged, body text updated), the
-- fleet_positions_receive_own_costumer policy's Realtime Broadcast topic
-- literal ('fleet-positions:fleetii-admin' -> 'fleet-positions:sysadm', see
-- fleet_positions_realtime_authorization.sql and its own two client/server
-- code call sites), and get_twohire_client_id()'s call site.
--
-- This is the DB half of a full-depth rename (app code + Netlify Functions
-- already updated in the same commit) -- see the app's own src/lib/roles.ts
-- for the client-side rename and its own history note. Exactly 1
-- user_profiles row per environment carried this role at the time of
-- writing (confirmed via direct query, both staging and production).
--
-- Single transaction so nothing is ever half-renamed: widen the CHECK
-- constraint first (so both spellings are briefly valid), migrate the data,
-- swap the function/policies over, then narrow the CHECK back down. Every
-- policy body below was pulled fresh from live pg_policies immediately
-- before writing this file (not copied from an older migration) to avoid
-- applying against drifted qual/with_check text.
--
-- Applied to FLEETii-DB-Staging on 2026-09-02. Production gets this same
-- file run manually, timed with that promotion's code deploy (see this
-- app's standing production-promotion policy) -- not run here.

begin;

-- 1. Widen the CHECK constraint so both the old and new role value are
-- valid while the data migrates below.
alter table public.user_profiles drop constraint user_profiles_role_check;
alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role = any (array['user'::text, 'admin'::text, 'FLEETii admin'::text, 'sysadm'::text]));

-- 2. Migrate the actual data.
update public.user_profiles set role = 'sysadm' where role = 'FLEETii admin';

-- 3. Create the new function (same body/security options as
-- is_fleetii_admin(), just the role literal and name updated).
create or replace function public.is_sysadm()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid() and role = 'sysadm' and deleted_at is null
  );
$function$;

-- 4. Drop and recreate every policy that referenced is_fleetii_admin(),
-- pointing at is_sysadm() instead -- renaming the 5 whose own name carried
-- "fleetii_admin", keeping the other 24 as they were named.

drop policy "bookings_delete_own_or_department_admin" on public.bookings;
create policy "bookings_delete_own_or_department_admin" on public.bookings
  for delete to authenticated
  using ((user_id = auth.uid()) OR is_sysadm() OR (is_admin() AND (department_id = current_department_id())));

drop policy "bookings_insert_own_department" on public.bookings;
create policy "bookings_insert_own_department" on public.bookings
  for insert to authenticated
  with check (is_sysadm() OR ((department_id = current_department_id()) AND (is_admin() OR (user_id = auth.uid()))));

drop policy "bookings_select_authenticated" on public.bookings;
create policy "bookings_select_authenticated" on public.bookings
  for select to authenticated
  using (is_sysadm() OR (exists (select 1 from public.vehicle_profiles vp where ((vp.vehicle_id = bookings.vehicle_id) AND (vp.costumer_id = current_costumer_id())))));

drop policy "bookings_update_own_or_department_admin" on public.bookings;
create policy "bookings_update_own_or_department_admin" on public.bookings
  for update to authenticated
  using ((user_id = auth.uid()) OR is_sysadm() OR (is_admin() AND (department_id = current_department_id())))
  with check (is_sysadm() OR ((department_id = current_department_id()) AND (is_admin() OR (user_id = auth.uid()))));

drop policy "costumer_orders_delete_admin_own_costumer" on public.costumer_orders;
create policy "costumer_orders_delete_admin_own_costumer" on public.costumer_orders
  for delete to authenticated
  using (is_sysadm() OR (is_admin() AND (costumer_id = current_costumer_id())));

drop policy "costumer_orders_insert_admin_own_costumer" on public.costumer_orders;
create policy "costumer_orders_insert_admin_own_costumer" on public.costumer_orders
  for insert to authenticated
  with check (is_sysadm() OR (is_admin() AND (costumer_id = current_costumer_id())));

drop policy "costumer_orders_select_admin_own_costumer" on public.costumer_orders;
create policy "costumer_orders_select_admin_own_costumer" on public.costumer_orders
  for select to authenticated
  using (is_sysadm() OR (is_admin() AND (costumer_id = current_costumer_id())));

drop policy "costumer_orders_update_fleetii_admin" on public.costumer_orders;
create policy "costumer_orders_update_sysadm" on public.costumer_orders
  for update to authenticated
  using (is_sysadm())
  with check (is_sysadm());

drop policy "costumers_insert_fleetii_admin" on public.costumers;
create policy "costumers_insert_sysadm" on public.costumers
  for insert to authenticated
  with check (is_sysadm());

drop policy "costumers_select_authenticated" on public.costumers;
create policy "costumers_select_authenticated" on public.costumers
  for select to authenticated
  using (is_sysadm() OR (costumer_id = current_costumer_id()));

drop policy "costumers_update_fleetii_admin" on public.costumers;
create policy "costumers_update_sysadm" on public.costumers
  for update to authenticated
  using (is_sysadm())
  with check (is_sysadm());

drop policy "department_settings_insert_admin_own_department" on public.department_settings;
create policy "department_settings_insert_admin_own_department" on public.department_settings
  for insert to authenticated
  with check (is_sysadm() OR (is_admin() AND (department_id = current_department_id())));

drop policy "department_settings_select_own_department" on public.department_settings;
create policy "department_settings_select_own_department" on public.department_settings
  for select to authenticated
  using ((department_id = current_department_id()) OR is_sysadm());

drop policy "department_settings_update_admin_own_department" on public.department_settings;
create policy "department_settings_update_admin_own_department" on public.department_settings
  for update to authenticated
  using (is_sysadm() OR (is_admin() AND (department_id = current_department_id())))
  with check (is_sysadm() OR (is_admin() AND (department_id = current_department_id())));

drop policy "departments_delete_fleetii_admin" on public.departments;
create policy "departments_delete_sysadm" on public.departments
  for delete to authenticated
  using (is_sysadm());

drop policy "departments_insert_fleetii_admin" on public.departments;
create policy "departments_insert_sysadm" on public.departments
  for insert to authenticated
  with check (is_sysadm());

drop policy "departments_select_authenticated" on public.departments;
create policy "departments_select_authenticated" on public.departments
  for select to authenticated
  using (is_sysadm() OR (costumer_id = current_costumer_id()));

drop policy "departments_update_admin_own_costumer" on public.departments;
create policy "departments_update_admin_own_costumer" on public.departments
  for update to authenticated
  using (is_sysadm() OR (is_admin() AND (costumer_id = current_costumer_id())))
  with check (is_sysadm() OR (is_admin() AND (costumer_id = current_costumer_id())));

-- Realtime Broadcast topic policy — also renames the topic literal itself
-- (see this file's own header comment); must land in the same transaction
-- as VehicleContext.tsx's subscribe call and 2hire-webhook.mts's publish
-- call being deployed, or the fleet-map Live GPS feature silently stops
-- delivering to a sysadm's browser mid-rollout.
drop policy "fleet_positions_receive_own_costumer" on "realtime"."messages";
create policy "fleet_positions_receive_own_costumer"
  on "realtime"."messages"
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (
      (select realtime.topic()) = 'fleet-positions:' || public.current_costumer_id()::text
      or (
        (select realtime.topic()) = 'fleet-positions:sysadm'
        and public.is_sysadm()
      )
    )
  );

drop policy "user_departments_delete_admin_own_costumer" on public.user_departments;
create policy "user_departments_delete_admin_own_costumer" on public.user_departments
  for delete to authenticated
  using (is_sysadm() OR (is_admin() AND (exists (select 1 from public.departments d where ((d.department_id = user_departments.department_id) AND (d.costumer_id = current_costumer_id()))))));

drop policy "user_departments_insert_admin_own_costumer" on public.user_departments;
create policy "user_departments_insert_admin_own_costumer" on public.user_departments
  for insert to authenticated
  with check (is_sysadm() OR (is_admin() AND (exists (select 1 from public.departments d where ((d.department_id = user_departments.department_id) AND (d.costumer_id = current_costumer_id())))) AND user_belongs_to_costumer(user_id, current_costumer_id())));

drop policy "user_departments_select_own_or_admin_costumer" on public.user_departments;
create policy "user_departments_select_own_or_admin_costumer" on public.user_departments
  for select to authenticated
  using ((user_id = auth.uid()) OR is_sysadm() OR (is_admin() AND (exists (select 1 from public.departments d where ((d.department_id = user_departments.department_id) AND (d.costumer_id = current_costumer_id()))))));

drop policy "user_profiles_select_admin_own_department" on public.user_profiles;
create policy "user_profiles_select_admin_own_department" on public.user_profiles
  for select to authenticated
  using (is_sysadm() OR (is_admin() AND (costumer_id = current_costumer_id())));

drop policy "user_settings_select_own_or_admin_own_department" on public.user_settings;
create policy "user_settings_select_own_or_admin_own_department" on public.user_settings
  for select to authenticated
  using ((user_id = auth.uid()) OR (is_admin() AND (exists (select 1 from public.user_profiles up where ((up.user_id = user_settings.user_id) AND (up.department_id = current_department_id()))))) OR is_sysadm());

drop policy "vehicle_departments_delete_admin_own_costumer" on public.vehicle_departments;
create policy "vehicle_departments_delete_admin_own_costumer" on public.vehicle_departments
  for delete to authenticated
  using (is_sysadm() OR (is_admin() AND (exists (select 1 from public.departments d where ((d.department_id = vehicle_departments.department_id) AND (d.costumer_id = current_costumer_id()))))));

drop policy "vehicle_departments_insert_admin_own_costumer" on public.vehicle_departments;
create policy "vehicle_departments_insert_admin_own_costumer" on public.vehicle_departments
  for insert to authenticated
  with check (is_sysadm() OR (is_admin() AND (exists (select 1 from public.departments d where ((d.department_id = vehicle_departments.department_id) AND (d.costumer_id = current_costumer_id()))))));

drop policy "vehicle_departments_select_authenticated" on public.vehicle_departments;
create policy "vehicle_departments_select_authenticated" on public.vehicle_departments
  for select to authenticated
  using (is_sysadm() OR (exists (select 1 from public.vehicle_profiles vp where ((vp.vehicle_id = vehicle_departments.vehicle_id) AND (vp.costumer_id = current_costumer_id())))));

drop policy "vehicle_profiles_select_authenticated" on public.vehicle_profiles;
create policy "vehicle_profiles_select_authenticated" on public.vehicle_profiles
  for select to authenticated
  using (is_sysadm() OR (costumer_id = current_costumer_id()));

drop policy "vehicle_profiles_update_admin_own_department" on public.vehicle_profiles;
create policy "vehicle_profiles_update_admin_own_department" on public.vehicle_profiles
  for update to authenticated
  using (is_sysadm() OR (is_admin() AND (exists (select 1 from public.vehicle_departments vd where ((vd.vehicle_id = vehicle_profiles.vehicle_id) AND (vd.department_id = current_department_id()))))))
  with check (is_sysadm() OR (is_admin() AND (exists (select 1 from public.vehicle_departments vd where ((vd.vehicle_id = vehicle_profiles.vehicle_id) AND (vd.department_id = current_department_id()))))));

drop policy "vehicle_signals_select_authenticated" on public.vehicle_signals;
create policy "vehicle_signals_select_authenticated" on public.vehicle_signals
  for select to authenticated
  using (is_sysadm() OR (exists (select 1 from public.vehicle_profiles vp where ((vp.vehicle_id = vehicle_signals.vehicle_id) AND (vp.costumer_id = current_costumer_id())))));

-- 5. Repoint get_twohire_client_id()'s call site at the new function name.
create or replace function public.get_twohire_client_id(p_costumer_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select twohire_client_id
  from public.costumers
  where costumer_id = p_costumer_id
    and public.is_sysadm();
$function$;

-- 6. Drop the old function now that nothing references it any more.
drop function public.is_fleetii_admin();

-- 7. Narrow the CHECK constraint back down -- no row can use the old value
-- any more (step 2 already migrated the only one there was).
alter table public.user_profiles drop constraint user_profiles_role_check;
alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role = any (array['user'::text, 'admin'::text, 'sysadm'::text]));

commit;
