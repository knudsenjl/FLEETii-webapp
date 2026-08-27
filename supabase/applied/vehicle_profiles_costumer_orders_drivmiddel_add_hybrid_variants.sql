-- Widens vehicle_profiles.drivmiddel and costumer_orders.drivmiddel's shared
-- CHECK constraint (see vehicle_profiles_add_drivmiddel.sql /
-- costumer_orders_add_drivmiddel.sql) to also allow "Hybrid/Benzin" and
-- "Hybrid/Diesel", inserted right after "Hybrid" — plain hybrids that don't
-- specify which fuel they pair with still just use "Hybrid". Still a plain
-- text column, not an enum, so this is just a constraint swap as those two
-- migrations' own comments anticipated ("adding a sixth option later is
-- just a constraint change, not a type migration") — no data backfill
-- needed since existing rows already hold one of the values still allowed.
--
-- costumer_orders' constraint is named costumer_orders_braendstof_check,
-- not costumer_orders_drivmiddel_check — a leftover auto-generated name
-- from before the column was renamed drivmiddel -> braendstof -> drivmiddel
-- (or similar); Postgres doesn't rename constraints along with the column
-- they're on, so its default-derived name is now stale. Confirmed against
-- pg_constraint on both staging and production before writing this.
alter table public.vehicle_profiles
  drop constraint vehicle_profiles_drivmiddel_check,
  add constraint vehicle_profiles_drivmiddel_check
    check (drivmiddel in ('Benzin', 'Diesel', 'El', 'Hybrid', 'Hybrid/Benzin', 'Hybrid/Diesel', 'Brint'));

alter table public.costumer_orders
  drop constraint costumer_orders_braendstof_check,
  add constraint costumer_orders_drivmiddel_check
    check (drivmiddel in ('Benzin', 'Diesel', 'El', 'Hybrid', 'Hybrid/Benzin', 'Hybrid/Diesel', 'Brint'));
