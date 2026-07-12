-- Prevents two overlapping bookings for the same vehicle at the database
-- level, closing the check-then-act race in ConfirmPage.tsx (availability is
-- read, then a separate INSERT follows — nothing stops two concurrent
-- requests from both passing the check and both inserting).
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Safe to run more than once (the extension uses IF NOT EXISTS, and the
-- constraint add is guarded so it won't error if already present).
--
-- IMPORTANT: if the table already contains overlapping bookings, the ALTER
-- TABLE below will fail with an error naming the conflicting rows. Resolve
-- those (cancel/adjust one of each conflicting pair) before re-running.
--
-- The range uses '[)' (inclusive start, exclusive end) so that a booking
-- ending at exactly the moment another starts does NOT count as an overlap —
-- this matches isVehicleAvailable()'s back-to-back-booking rule in
-- src/lib/bookings.ts.

create extension if not exists btree_gist;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_no_overlap'
  ) then
    alter table public."Bookings"
      add constraint bookings_no_overlap
      exclude using gist (
        vehicle_id with =,
        tstzrange(start, "end", '[)') with &&
      );
  end if;
end $$;
