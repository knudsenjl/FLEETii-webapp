-- Replaces bookings.user (text email) with user_id (uuid, FK to
-- user_profiles.user_id) — same pattern as the department_id migrations:
-- value-preserving via a join on user_profiles.email, NOT random uuids,
-- since this is a real relationship (who the booking is for), not an
-- opaque identifier.
--
-- Drops and recreates the two RLS policies that reference "user" upfront
-- (learned the hard way with every previous migration in this series —
-- handle dependents before attempting the column drop, not after it
-- fails). Both are simplified in the same pass: comparing
-- user_id = auth.uid() directly needs no helper function at all (unlike
-- the old "user" = current_email() comparison), since auth.uid() already
-- IS exactly what user_id stores. rls_policies.sql (updated alongside
-- this migration) recreates them properly — this file only drops them so
-- the column can be dropped.
--
-- RUN THIS BEFORE deploying the matching app-code change (bookings.ts
-- etc.) — same reasoning as every prior migration in this series: there's
-- an unavoidable brief window either way. Between running this file and
-- rls_policies.sql, users temporarily lose the ability to create or
-- cancel bookings (RLS fails closed on a missing policy) — run
-- rls_policies.sql right after this one.
--
-- Rows whose old "user" email didn't match any user_profiles.email are
-- left with a null user_id (matching the old column's nullability, and
-- the same graceful-degradation approach used for department_id) rather
-- than guessed.
--
-- Safe to re-run: every step guarded.

-- 1. Add user_id uuid column if it doesn't already exist.
alter table public.bookings add column if not exists user_id uuid;

-- 2. Populate from the old user text column, matching by email.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'user'
  ) then
    update public.bookings
    set user_id = user_profiles.user_id
    from public.user_profiles
    where bookings."user" = user_profiles.email
      and bookings.user_id is null;
  end if;
end $$;

-- 3. Drop the two RLS policies that reference "user".
drop policy if exists "bookings_insert_own_department" on public.bookings;
drop policy if exists "bookings_delete_own_or_department_admin" on public.bookings;

-- 4. Drop the old user column.
alter table public.bookings drop column if exists "user";

-- 5. Add the new foreign key to user_profiles.user_id.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_user_id_fkey' and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_user_id_fkey
      foreign key (user_id) references public.user_profiles (user_id);
  end if;
end $$;
