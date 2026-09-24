-- Final cleanup of the UTC time refactor (see bookings_add_legacy_wallclock.sql
-- and bookings_convert_legacy_wallclock_to_utc.sql): every booking on both
-- environments is converted, so the transitional marker column goes.
--
-- ORDER MATTERS per environment: run only once code that no longer writes
-- `legacy_wallclock` (ConfirmPage.tsx / seed-test-bookings.mts) is deployed
-- THERE — older code still sends the column and every booking insert would
-- fail while it's missing. The column default was already set to false on
-- both environments (2026-09-24), so the order is safe in the other direction.

alter table public.bookings drop column if exists legacy_wallclock;
