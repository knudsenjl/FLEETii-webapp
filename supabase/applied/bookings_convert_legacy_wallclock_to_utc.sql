-- STEP 3 of the UTC time refactor (step 1: bookings_add_legacy_wallclock.sql;
-- step 2: deploying the code that writes real UTC). Run on each environment
-- right AFTER step 2's deploy is live there — between the two, legacy rows
-- display 1-2 hours off (cosmetic only; nothing is written wrongly).
--
-- Converts every row still marked legacy_wallclock = true from "Danish
-- wall-clock digits stored as UTC" to the real UTC instant:
--   (x at time zone 'UTC')               -> the naive Danish digits again
--   ... at time zone 'Europe/Copenhagen' -> those digits read as Danish time
-- e.g. a booking typed as 12:00 on a summer date (stored 12:00+00) becomes
-- 10:00+00; on a winter date 11:00+00. DST-correct per row.
--
-- bookings_no_overlap is non-deferrable, so a row moved earlier could
-- collide mid-UPDATE with a neighbour that hasn't been moved yet — it's
-- dropped and recreated inside the same transaction (identical definition).
-- If this fails (e.g. a legacy row's end was set to real UTC by "Afslut"
-- during the deploy window, putting end before start after conversion), the
-- whole transaction rolls back and nothing changes — fix that row by hand
-- and re-run.
--
-- Idempotent: only touches rows still marked legacy.

begin;

alter table public.bookings drop constraint bookings_no_overlap;

update public.bookings set
  start = (start at time zone 'UTC') at time zone 'Europe/Copenhagen',
  "end" = ("end" at time zone 'UTC') at time zone 'Europe/Copenhagen',
  legacy_wallclock = false
where legacy_wallclock;

alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (vehicle_id with =, tstzrange(start, "end", '[)') with &&);

commit;

-- LATER CLEANUP (once every environment is converted): new rows no longer
-- need the flag at all.
--   alter table public.bookings alter column legacy_wallclock set default false;
-- and in a following release, after removing the `legacy_wallclock: false`
-- writes from ConfirmPage.tsx/seed-test-bookings.mts:
--   alter table public.bookings drop column legacy_wallclock;
