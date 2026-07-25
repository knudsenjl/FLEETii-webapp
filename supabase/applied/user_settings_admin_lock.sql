-- Implements the actual intended Rettigheder permission model (clarified in
-- conversation, not what was built originally): a regular user MAY change
-- their own Tillad_* flags directly — but if an ADMIN has explicitly denied
-- one (set it to false), the user can never undo that themselves (neither by
-- toggling it back to true, nor by "Nulstil"-ing it away, which would just
-- let the department default apply instead — an indirect way around the
-- same denial). If an admin's current value is true (or there's no admin
-- override at all, just the department default), the user remains free to
-- restrict it for themselves, and to undo that restriction again later.
--
-- This needs the DB to track WHO set the CURRENT value, not just what it is
-- — added as locked_by_admin, maintained automatically by a trigger (never
-- trusted from client input, so a self-write can't just claim
-- locked_by_admin=false to unlock a denial):
--   - value_bool = true  -> locked_by_admin = false (a granted right, by
--     anyone, is never locked — matches "if admin gives a right, the user
--     can disallow it [again later]").
--   - value_bool = false, written by an admin -> locked_by_admin = true.
--   - value_bool = false, written by the row's own user -> locked_by_admin
--     stays false (self-imposed, freely reversible by that same user).
--   - Any non-Tillad_* row (e.g. a user's personal Anvendelse additions) ->
--     always false; this column is meaningless outside the four Tillad_*
--     names.
--
-- Rewrites the three write policies from "Tillad_* writable by admin only"
-- to "self writable unless locked_by_admin, or admin (own department,
-- unaffected by any lock)".
--
-- Safe to re-run: column add is idempotent, function is CREATE OR REPLACE,
-- trigger/policies dropped before recreated.

alter table public.user_settings add column if not exists locked_by_admin boolean not null default false;

-- Backfill: every EXISTING Tillad_*=false row was necessarily written by an
-- admin — the prior policy (user_settings_restrict_tillad_writes.sql /
-- reassert_user_settings_tillad_writes.sql) required is_admin() for every
-- Tillad_* write, with no self-write path at all, so there's no ambiguity
-- about provenance here (unlike a fresh column default, which can't know
-- this). This is what correctly marks user@hjort.dk's existing
-- Tillad_ny_reservation=false row as locked.
update public.user_settings
set locked_by_admin = true
where name in (
    'Tillad_ny_reservation',
    'Tillad_rediger_reservation',
    'Tillad_slet_reservation',
    'Tillad_reservation_uden_sluttidspunkt'
  )
  and coalesce(value_bool, false) = false;

create or replace function public.set_user_settings_admin_lock()
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
  ) then
    if new.value_bool is true then
      new.locked_by_admin := false;
    else
      new.locked_by_admin := public.is_admin();
    end if;
  else
    new.locked_by_admin := false;
  end if;
  return new;
end;
$$;

drop trigger if exists user_settings_set_admin_lock on public.user_settings;
create trigger user_settings_set_admin_lock
  before insert or update on public.user_settings
  for each row
  execute function public.set_user_settings_admin_lock();

-- INSERT: a fresh row has nothing to protect yet, so self-insert is always
-- fine regardless of name; an admin may also insert a Tillad_* row for a
-- user in their own department.
drop policy if exists "user_settings_insert_own_or_admin" on public.user_settings;
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

-- UPDATE: self-update allowed unless the EXISTING row is a locked Tillad_*
-- denial (checked via `using`, which sees the row as it is now — the
-- trigger above then recomputes locked_by_admin for the row as it will BE,
-- so a self-write of a not-yet-locked row can never itself set the lock).
drop policy if exists "user_settings_update_own_or_admin" on public.user_settings;
create policy "user_settings_update_own_or_admin" on public.user_settings
  for update
  to authenticated
  using (
    (
      user_id = auth.uid()
      and not (
        name in (
          'Tillad_ny_reservation',
          'Tillad_rediger_reservation',
          'Tillad_slet_reservation',
          'Tillad_reservation_uden_sluttidspunkt'
        )
        and locked_by_admin
      )
    )
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

-- DELETE ("Nulstil"): same "not locked" guard as UPDATE — clearing a locked
-- denial would just let the department default apply instead, an indirect
-- way around the same lock, so it needs the exact same protection.
drop policy if exists "user_settings_delete_own_or_admin" on public.user_settings;
create policy "user_settings_delete_own_or_admin" on public.user_settings
  for delete
  to authenticated
  using (
    (
      user_id = auth.uid()
      and not (
        name in (
          'Tillad_ny_reservation',
          'Tillad_rediger_reservation',
          'Tillad_slet_reservation',
          'Tillad_reservation_uden_sluttidspunkt'
        )
        and locked_by_admin
      )
    )
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
