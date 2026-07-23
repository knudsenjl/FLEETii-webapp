-- Lets a "FLEETii admin" (and only that role — not plain "admin") create
-- new costumers directly from the browser (FleetiiAdministrationPage's
-- new "Ny kunde" button -> CostumerDetailsPage's create form). costumers
-- only had a SELECT policy until now (costumers_select_policy.sql) — a
-- direct client insert would be rejected outright by RLS (no policy for a
-- command = that command is refused, not silently empty like a missing
-- SELECT policy).
--
-- is_fleetii_admin() mirrors is_admin()'s exact pattern (rls_policies.sql)
-- but checks role = 'FLEETii admin' specifically, since that's a stricter,
-- separate role from plain "admin" and no existing helper covers it.
--
-- The costumers_create_default_department trigger (see
-- departments_unique_per_costumer_and_auto_create.sql) already runs
-- SECURITY DEFINER, so the resulting departments insert isn't blocked by
-- departments' own RLS regardless of who performs this insert.
--
-- Safe to re-run: CREATE OR REPLACE / GRANT are idempotent, policy is
-- dropped before recreated.

create or replace function public.is_fleetii_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid() and role = 'FLEETii admin'
  );
$$;

grant insert on public.costumers to authenticated;

drop policy if exists "costumers_insert_fleetii_admin" on public.costumers;
create policy "costumers_insert_fleetii_admin" on public.costumers
  for insert
  to authenticated
  with check (public.is_fleetii_admin());
