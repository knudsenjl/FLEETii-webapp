-- Creates the three costumer rows that departments.costumer_id already
-- points at (added before costumer had any rows — see the FK violation
-- this fixes). Name is GUESSED as matching each department's own name,
-- since nothing else indicates what these customers should be called —
-- verify/correct before relying on this.
--
-- Safe to re-run: ON CONFLICT DO NOTHING (requires costumer_id to be
-- unique/PK, per costumer_costumer_id_to_uuid.sql).
insert into public.costumer (costumer_id, name) values
  ('f2b730f6-9cf5-40de-8971-ebc388a6a09b', 'FLEETii (test biler)'),
  ('8dfa6c51-8ca8-4925-806f-8d1754cbb470', 'FLEETII administration'),
  ('986ecc69-2ade-4406-8796-b3bb1fa42c60', 'Jonas Hjort')
on conflict (costumer_id) do nothing;
