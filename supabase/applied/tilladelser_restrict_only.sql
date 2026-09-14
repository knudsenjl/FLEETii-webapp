-- Simplifies the Tilladelser model from user_settings_department_ceiling.sql's
-- bidirectional-override-with-ceiling to restrict-only: a user_settings
-- Tillad_* row can now ONLY ever hold value_bool = false (a per-user
-- restriction on top of what the department allows). It can never grant a
-- right the department doesn't already give — that capability is
-- deliberately removed (confirmed with the user: closes the "absent
-- department = no ceiling" loophole and, more importantly, removes the
-- bidirectional override that made "Nulstil" ambiguous — it had to mean
-- both "undo a restriction" and "undo a grant"). Un-restricting is now
-- simply deleting the row, so the frontend's separate Nulstil control goes
-- away entirely (see RettighederSettings.tsx).
--
-- Safe to re-run: drops guarded by IF EXISTS, function is CREATE OR
-- REPLACE, trigger dropped before recreated.

-- 1. Ceiling trigger becomes unconditional: value_bool = true is never
-- legal on a user_settings row for these four flags, full stop — no more
-- department lookup, since a user can no longer exceed the department
-- value in either the false or the absent case. Same error message as
-- before; it already reads correctly under restrict-only ("you can't
-- assign a user a right the department doesn't make available").
create or replace function public.enforce_user_settings_department_ceiling()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  raise exception 'Denne rettighed er slået fra på afdelingsniveau og kan ikke tillades for en enkelt bruger.';
end;
$$;

drop trigger if exists user_settings_enforce_department_ceiling on public.user_settings;
create trigger user_settings_enforce_department_ceiling
  before insert or update on public.user_settings
  for each row
  execute function public.enforce_user_settings_department_ceiling();

-- 2. The cascade-down trigger is now dead code: it existed to force-delete
-- user-level TRUE rows when a department flag was lowered to false, but a
-- user-level row can never be true anymore (enforced above), so there is
-- nothing left for a department change to cascade into.
drop trigger if exists department_settings_cascade_ceiling on public.department_settings;
drop function if exists public.cascade_department_settings_ceiling();

-- 3. One-time cleanup: any EXISTING user_settings row with value_bool =
-- true for these four flags is a per-user grant from the old model and is
-- now illegal — delete it (the user then simply inherits their
-- department's value, same as if they'd never had an override). This
-- silently revokes any currently-active "let just this one user do X even
-- though the department doesn't" grant, so the row count is surfaced via
-- RAISE NOTICE — check it before/after running this in the SQL editor.
do $$
declare
  deleted_count integer;
begin
  delete from public.user_settings
  where value_bool = true
    and name in (
      'Tillad_ny_reservation',
      'Tillad_rediger_reservation',
      'Tillad_slet_reservation',
      'Tillad_reservation_uden_sluttidspunkt'
    );
  get diagnostics deleted_count = row_count;
  raise notice 'tilladelser_restrict_only: deleted % now-illegal true user_settings row(s)', deleted_count;
end;
$$;

-- 4. RLS policies (user_settings_insert/update/delete_own_or_admin from
-- user_settings_department_ceiling.sql) are unchanged — they already gate
-- purely on name + department membership, not on direction. The trigger
-- above is what decides whether a given value is legal to write.
