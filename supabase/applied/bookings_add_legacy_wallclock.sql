-- STEP 1 of the UTC time refactor (see CLAUDE.md "Time handling" and
-- src/lib/time.ts). Run on each environment BEFORE the code that writes
-- legacy_wallclock is deployed there — ConfirmPage/seed-test-bookings write
-- `legacy_wallclock: false`, which fails outright if the column is missing.
--
-- Until this refactor, bookings.start/"end" held the Danish wall-clock time
-- the user typed, stored as if it were UTC (e.g. 12:00 Danish time stored as
-- 12:00+00, i.e. really 14:00 Danish time in summer). This column marks which
-- rows are still in that old format:
--   * DEFAULT true — every existing row, AND every row the still-running old
--     code inserts before the new code is deployed, is legacy.
--   * The new code always writes false together with real UTC values; the
--     old code never touches this column, so its rows stay true.
-- Step 2 is the code deploy; step 3 (bookings_convert_legacy_wallclock_to_utc.sql)
-- converts every row still marked true, whenever it runs — so the deploy and
-- the conversion don't have to happen at the same instant.
--
-- Safe to re-run.

alter table public.bookings add column if not exists legacy_wallclock boolean not null default true;

comment on column public.bookings.legacy_wallclock is
  'Transitional (UTC time refactor, 2026-09-24): true = start/end still hold Danish wall-clock time stored as UTC; converted by bookings_convert_legacy_wallclock_to_utc.sql. Drop once all environments are converted.';

-- STAGING ONLY (run by hand on staging, never on production): rows inserted
-- by seed-test-bookings.mts were ALREADY real UTC (it always used
-- toISOString(), which is also why they carry milliseconds — rows typed in
-- the app are whole minutes). Mark those as converted so step 3 doesn't
-- shift them:
--
--   update public.bookings set legacy_wallclock = false
--   where extract(milliseconds from start)::numeric % 1000 <> 0;
