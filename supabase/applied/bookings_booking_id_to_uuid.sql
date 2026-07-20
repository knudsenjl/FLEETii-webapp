-- Converts public.bookings.booking_id's type to uuid (name unchanged,
-- unlike the vehicle_log migration — this one is a pure type change).
-- Guarded so it's safe to re-run.
--
-- IMPORTANT — read before running: if booking_id is currently an
-- integer/bigint identity column (the typical case for a column named
-- "..._id") and the table already has rows, converting via
-- `USING gen_random_uuid()` assigns each EXISTING row a brand new,
-- unrelated uuid — the original numeric ids are permanently lost. Nothing
-- in this app's code does numeric arithmetic/parsing on booking ids (only
-- equality checks, .eq() filters, and passing the value through router
-- state — confirmed via a full-repo search), so this is safe from the
-- application's side regardless. It's only a concern if something outside
-- this codebase (a report, an export, a support ticket referencing a
-- specific numeric booking id) depends on the OLD values persisting.
--
-- No FK/constraint handling needed: nothing in this repo's tracked SQL
-- references bookings.booking_id from another table, and
-- bookings_no_overlap (the EXCLUDE constraint — see
-- supabase/bookings_end_nullable.sql's context) is defined over
-- (vehicle_id, tstzrange(start, "end")), not booking_id, so it's
-- unaffected by this column's type change. Renaming/retyping a primary-key
-- column doesn't require dropping that constraint either — Postgres
-- updates it automatically, and gen_random_uuid() guarantees the
-- uniqueness the PK requires stays satisfied.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name = 'booking_id' and data_type <> 'uuid'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'bookings'
        and column_name = 'booking_id' and is_identity = 'YES'
    ) then
      alter table public.bookings alter column booking_id drop identity;
    end if;

    alter table public.bookings alter column booking_id drop default;
    alter table public.bookings alter column booking_id type uuid using gen_random_uuid();
    alter table public.bookings alter column booking_id set default gen_random_uuid();
  end if;
end $$;
