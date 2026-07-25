-- Replaces user_settings_admin_lock.sql's authorship-tracking approach
-- (locked_by_admin) with the actual intended model, clarified in
-- conversation: there is no such thing as "who set this value" — the ONLY
-- constraint is a hard ceiling: a user-level Tillad_* row can never be
-- `true` while the department's own row for that same flag is `false`,
-- checked purely against the department's CURRENT value, regardless of who
-- is writing (self or admin). Either party may set OR unset their own
-- user-level row freely at any time — Nulstil is never restricted. If an
-- admin lowers a department flag to false while some user's row is
-- currently true, that user's row is forced down (deleted) immediately,
-- not left dangling in violation.
--
-- department-level itself stays set-only (no unset/delete capability) —
-- confirmed intentional, not a gap: an admin manages it by changing its
-- value, not by clearing it.
--
-- Drops the entire locked_by_admin mechanism: column, its trigger/function,
-- and the RLS policies that referenced it — replaced by two new triggers
-- (the ceiling check on user_settings writes, and the cascade-down on
-- department_settings writes) plus RLS policies with no name-based
-- restriction on self-writes at all (a user may always manage their own
-- row, Tillad_* included — enforcement of the ceiling is the trigger's job,
-- not RLS's).
--
-- Safe to re-run: drops guarded by IF EXISTS, functions are CREATE OR
-- REPLACE, triggers/policies dropped before recreated. The policies
-- referencing locked_by_admin are dropped FIRST, before the column itself —
-- Postgres refuses to drop a column something else still depends on.

-- 1. Drop the policies that reference locked_by_admin — must happen before
-- the column drop below, or Postgres refuses ("other objects depend on it").
drop policy if exists "user_settings_insert_own_or_admin" on public.user_settings;
drop policy if exists "user_settings_update_own_or_admin" on public.user_settings;
drop policy if exists "user_settings_delete_own_or_admin" on public.user_settings;

-- 2. Remove the old authorship-tracking mechanism entirely.
drop trigger if exists user_settings_set_admin_lock on public.user_settings;
drop function if exists public.set_user_settings_admin_lock();
alter table public.user_settings drop column if exists locked_by_admin;

-- 3. Ceiling check: reject any write that would set a Tillad_* flag to true
-- for a user whose department currently has that same flag set to false.
-- Only the "true" direction is constrained — disallow and unset are always
-- fine at the user level, from anyone.
create or replace function public.enforce_user_settings_department_ceiling()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dept_id uuid;
  dept_value boolean;
begin
  if new.value_bool is distinct from true then
    return new;
  end if;
  if new.name not in (
    'Tillad_ny_reservation',
    'Tillad_rediger_reservation',
    'Tillad_slet_reservation',
    'Tillad_reservation_uden_sluttidspunkt'
  ) then
    return new;
  end if;

  select department_id into dept_id from public.user_profiles where user_id = new.user_id;
  if dept_id is null then
    return new;
  end if;

  select value_bool into dept_value
  from public.department_settings
  where name = new.name and department_id = dept_id;

  if dept_value is false then
    raise exception 'Denne rettighed er slået fra på afdelingsniveau og kan ikke tillades for en enkelt bruger.';
  end if;

  return new;
end;
$$;

drop trigger if exists user_settings_enforce_department_ceiling on public.user_settings;
create trigger user_settings_enforce_department_ceiling
  before insert or update on public.user_settings
  for each row
  execute function public.enforce_user_settings_department_ceiling();

-- 4. Cascade-down: when a department's Tillad_* flag is set to false, force
-- down (delete) any user-level row in that department currently true for
-- the same flag, so the ceiling invariant holds immediately, not just at
-- the next time someone happens to touch that user's row.
create or replace function public.cascade_department_settings_ceiling()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name in (
    'Tillad_ny_reservation',
    'Tillad_rediger_reservation',
    'Tillad_slet_reservation',
    'Tillad_reservation_uden_sluttidspunkt'
  ) and new.value_bool is false then
    delete from public.user_settings us
    using public.user_profiles up
    where us.user_id = up.user_id
      and up.department_id = new.department_id
      and us.name = new.name
      and us.value_bool = true;
  end if;
  return new;
end;
$$;

drop trigger if exists department_settings_cascade_ceiling on public.department_settings;
create trigger department_settings_cascade_ceiling
  after insert or update on public.department_settings
  for each row
  execute function public.cascade_department_settings_ceiling();

-- 5. Simplified RLS: self may always manage their own row (any name); an
-- admin may manage a Tillad_* row for a user in their own department. No
-- locked_by_admin reference anywhere — the ceiling trigger above is what
-- actually enforces the invariant, uniformly regardless of writer.
create policy "user_settings_insert_own_or_admin" on public.user_settings
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
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

create policy "user_settings_update_own_or_admin" on public.user_settings
  for update
  to authenticated
  using (
    user_id = auth.uid()
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
    user_id = auth.uid()
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

create policy "user_settings_delete_own_or_admin" on public.user_settings
  for delete
  to authenticated
  using (
    user_id = auth.uid()
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
