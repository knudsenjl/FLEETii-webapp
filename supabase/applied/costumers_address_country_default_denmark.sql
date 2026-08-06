-- Almost every costumer is Danish, so address_country defaults to
-- "Danmark" instead of staying empty — both for future rows inserted
-- without an explicit value, and backfilled onto the existing rows that
-- were left null by costumers_split_address_into_three_fields.sql (the old
-- single-line address never had a country to split out). Still a plain
-- editable text field, not an enum — this is a convenience default, not a
-- restriction to Danish costumers only.
alter table public.costumers alter column address_country set default 'Danmark';
update public.costumers set address_country = 'Danmark' where address_country is null;
