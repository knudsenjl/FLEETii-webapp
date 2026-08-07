-- Adds "P-plads" (parking spot) to vehicle_profiles — plain free-text, no
-- fixed set of values like drivmiddel has. Existing vehicles are backfilled
-- with a one-time randomized "P" + two-digit number (e.g. "P42") purely as
-- placeholder demo/test data, not a real fact about these vehicles — same
-- convention as vehicle_profiles_add_drivmiddel.sql's own random backfill.
alter table public.vehicle_profiles add column parking text;

update public.vehicle_profiles
set parking = 'P' || lpad((floor(random() * 100))::int::text, 2, '0');
