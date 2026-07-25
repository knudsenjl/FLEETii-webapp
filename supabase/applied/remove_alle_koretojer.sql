-- Removes the "Alle køretøjer" default-department concept entirely — every
-- trigger/function that auto-created it, auto-granted admins access to it,
-- auto-assigned every vehicle to it, and protected it from deletion; the two
-- RLS policies that special-cased its name; and every existing row that
-- referenced it (per check_alle_koretojer_purge_safety.sql /
-- check_hjort_alternative_departments.sql's confirmed results: 3 costumers
-- have one each, 0 vehicles/admins depend on it as their ONLY department,
-- 0 bookings reference it — the one truly irreversible case — 39
-- vehicle_profiles rows and 1 user_profiles row (admin@hjort.dk) point at
-- it as their "home", and 3 department_settings rows are scoped to it).
--
-- Made obsolete by VehiclesPage.tsx's new Afdeling filter (an explicit
-- "Alle" = no-filter option already covers what this department used to
-- guarantee — every vehicle/admin reachable without a fake always-present
-- department in the way).
--
-- IMPORTANT side effect: costumers_create_default_department was what gave
-- every new costumer at least one department to start with. Without it, a
-- newly created costumer has ZERO departments — a FLEETii admin must now
-- go create at least one manually via DepartmentDetailsPage
-- ("Administration af afdelinger") before any user can be added for that
-- costumer (UserDetailsPage's Hjemmeafdeling picker has nothing to offer
-- otherwise). This is expected now that page exists, not a gap.
--
-- Order matters throughout: triggers dropped first (so no data-purge step
-- below can accidentally re-trigger a row it just removed), then the data
-- purge itself in FK-safe order (nullable/reassignable references cleared
-- before the rows they point to are deleted), then the two RLS policies
-- reverted to their plain (no name-based exception) form, and only then the
-- departments rows themselves.
--
-- Safe to re-run: every drop is IF EXISTS, deletes/updates are idempotent
-- (matching rows are simply already gone/reassigned on a second run).

-- 1. Drop every trigger + function that specially created/granted/protected
-- "Alle køretøjer".
drop trigger if exists costumers_create_default_department on public.costumers;
drop function if exists public.create_default_department_for_costumer();

drop trigger if exists user_profiles_grant_alle_koretojer on public.user_profiles;
drop function if exists public.grant_alle_koretojer_to_admin();

drop trigger if exists vehicle_departments_assign_alle_koretojer on public.vehicle_departments;
drop function if exists public.assign_vehicle_to_alle_koretojer();

-- 2. Data purge, in FK-safe order.

-- 2a. Clear vehicle_profiles' home-department reference (nullable column —
-- these vehicles simply show no Hjemmeafdeling until an admin picks a real
-- one via HandleVehiclePage, same as any vehicle never assigned one).
update public.vehicle_profiles vp
set department_id = null
from public.departments d
where d.department_id = vp.department_id
  and d.name = 'Alle køretøjer';

-- 2b. Delete department_settings rows scoped to it (just current
-- Tillad_*/Anvendelse/Standard configuration, not historical data).
delete from public.department_settings ds
using public.departments d
where d.department_id = ds.department_id
  and d.name = 'Alle køretøjer';

-- 2c. Delete every vehicle's membership in it (vehicle_departments) — this
-- IS the purge; every vehicle keeps whatever other department(s) it was
-- actually, deliberately assigned to.
delete from public.vehicle_departments vdep
using public.departments d
where d.department_id = vdep.department_id
  and d.name = 'Alle køretøjer';

-- 2d. Delete every admin's auto-granted membership in it (user_departments)
-- — same idea, admins keep their real grants.
delete from public.user_departments ud
using public.departments d
where d.department_id = ud.department_id
  and d.name = 'Alle køretøjer';

-- 2e. Reassign the one user whose ACTIVE home department is "Alle
-- køretøjer" (admin@hjort.dk, confirmed via
-- check_alle_koretojer_purge_safety.sql's query 5) to their costumer's only
-- real alternative, "Udlejningsbiler" (confirmed via
-- check_hjort_alternative_departments.sql) — and make sure they hold a
-- matching user_departments grant for it, maintaining this app's own
-- invariant that a user's home department is always among their own grants
-- (see UserDetailsPage.tsx's self-heal effect).
update public.user_profiles
set department_id = '9d1a5566-79fb-48bd-9832-a0864b3d362f'
where user_id = 'dcabb8f4-0292-4462-b486-8ac0e11bcc66';

insert into public.user_departments (user_id, department_id)
values ('dcabb8f4-0292-4462-b486-8ac0e11bcc66', '9d1a5566-79fb-48bd-9832-a0864b3d362f')
on conflict (user_id, department_id) do nothing;

-- 3. Revert the two RLS policies that special-cased its name — back to
-- their plain, pre-"Alle køretøjer" form.
drop policy if exists "departments_delete_fleetii_admin" on public.departments;
create policy "departments_delete_fleetii_admin" on public.departments
  for delete
  to authenticated
  using (public.is_fleetii_admin());

drop policy if exists "vehicle_departments_delete_admin_own_costumer" on public.vehicle_departments;
create policy "vehicle_departments_delete_admin_own_costumer" on public.vehicle_departments
  for delete
  to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.departments d
      where d.department_id = vehicle_departments.department_id
        and d.costumer_id = public.current_costumer_id()
    )
  );

-- 4. Finally, delete the departments rows themselves — every referencing
-- row above has already been cleared/reassigned, so this is now a clean
-- delete with nothing left pointing at them.
delete from public.departments where name = 'Alle køretøjer';
