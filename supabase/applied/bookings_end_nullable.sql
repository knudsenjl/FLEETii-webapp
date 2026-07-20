-- Allows a booking's "end" to be NULL, meaning "open-ended" (occupies the
-- vehicle indefinitely from "start" onward, no known end). ReservationPage's
-- "ignore end" toggle already produces and submits a null end today; this
-- migration is what lets the database actually accept it.
--
-- Does NOT touch the booking-overlap exclusion constraint. That constraint
-- isn't checked into this repo (see supabase/applied/rename_vehicle_id_to_uuid.sql's
-- header for the same residual-risk note), but Postgres's range constructors
-- treat a NULL bound as unbounded (tstzrange(start, NULL) = [start, infinity)),
-- so a typical `EXCLUDE USING gist (vehicle_id WITH =, tstzrange(start, "end") WITH &&)`
-- constraint should already reject any booking that would overlap an
-- open-ended one, with no changes needed. Verify this after running (try
-- creating two overlapping bookings where one is open-ended) — if the
-- constraint turns out to be shaped differently, it'll need a separate,
-- informed fix rather than a blind guess here.
--
-- Safe to re-run.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name = 'end' and is_nullable = 'NO'
  ) then
    alter table public.bookings alter column "end" drop not null;
  end if;
end $$;
