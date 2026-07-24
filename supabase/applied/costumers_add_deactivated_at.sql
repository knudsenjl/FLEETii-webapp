-- Adds a "Deaktiver kunde"/"Genaktiver kunde" costumer-wide login lockout
-- (see CostumerDetailsPage.tsx, FLEETii-admin only) — a reversible state
-- for disputes/non-payment, distinct from the later, irreversible
-- "Slet kunde" full data purge (see costumer_purge_function.sql).
--
-- Primary enforcement is client-side (AuthContext.tsx/LoginPage.tsx force
-- sign-out + block login). This migration adds a DB-level backstop:
-- is_admin()/current_department_id()/current_costumer_id() — the three
-- SECURITY DEFINER helpers nearly every admin-scoped RLS policy in this
-- schema is built on — now inner-join costumers and additionally require
-- deactivated_at is null, so writes gated by those helpers (e.g.
-- bookings_insert_own_department's "department_id = current_department_id()"
-- check) get centrally blocked too, without touching every individual
-- policy file. is_fleetii_admin() is deliberately NOT changed — a FLEETii
-- admin must keep working against a deactivated costumer's own data in
-- order to reactivate or eventually purge it.
--
-- Known, accepted residual gaps (not closed here): a couple of policies
-- check auth.uid() = user_id directly rather than going through these
-- helpers (bookings_delete_own_or_department_admin's own-booking branch,
-- user_profiles_update_own_department's own-department-switch check) — a
-- deactivated costumer's user could still cancel their own booking or
-- switch their own active department mid-session, until the client-side
-- lockout forces sign-out or their token naturally expires. Acceptable
-- trade-off vs. auditing every policy in the schema.
--
-- IMPORTANT — before running, check whether any real (non-test) user has a
-- null costumer_id: `select count(*) from user_profiles where costumer_id
-- is null;`. The switch to an inner join means such a row now gets NULL
-- back from these helpers where it previously would have still returned
-- its department_id. If that count is nonzero for a real active account,
-- flag it before proceeding — this migration assumes it's zero.
--
-- Run in the Supabase SQL editor. Safe to run more than once.

alter table public.costumers add column if not exists deactivated_at timestamptz;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.user_profiles up
    join public.costumers c on c.costumer_id = up.costumer_id
    where up.user_id = auth.uid()
      and up.role = 'admin'
      and up.deleted_at is null
      and c.deactivated_at is null
  );
$$;

create or replace function public.current_department_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select up.department_id
  from public.user_profiles up
  join public.costumers c on c.costumer_id = up.costumer_id
  where up.user_id = auth.uid()
    and up.deleted_at is null
    and c.deactivated_at is null;
$$;

create or replace function public.current_costumer_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select up.costumer_id
  from public.user_profiles up
  join public.costumers c on c.costumer_id = up.costumer_id
  where up.user_id = auth.uid()
    and up.deleted_at is null
    and c.deactivated_at is null;
$$;
