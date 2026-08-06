-- Adds "Drivmiddel" (fuel/propellant type) to vehicle_profiles. Defaults to
-- "Benzin" for every future vehicle (matches the DB default a plain insert
-- gets when the column is omitted, e.g. 2hire-register-vehicle.mts's
-- upsert, which doesn't set this field) — a CHECK constraint keeps it to
-- the five values FLEETii actually distinguishes, still a plain text
-- column rather than an enum type so adding a sixth option later is just
-- a constraint change, not a type migration.
--
-- Existing rows are then randomly redistributed across all five values
-- (rather than left at the "Benzin" default every ADD COLUMN ... DEFAULT
-- would otherwise backfill them to) — there's no real historical data to
-- derive this from, so this is explicitly a one-time randomized seed for
-- demo/test purposes, not a real fact about these vehicles.
alter table public.vehicle_profiles
  add column drivmiddel text not null default 'Benzin'
    check (drivmiddel in ('Benzin', 'Diesel', 'El', 'Hybrid', 'Brint'));

update public.vehicle_profiles
set drivmiddel = (array['Benzin', 'Diesel', 'El', 'Hybrid', 'Brint'])[floor(random() * 5)::int + 1];
