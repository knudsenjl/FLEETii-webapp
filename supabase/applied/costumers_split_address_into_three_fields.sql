-- Replaces costumers' single free-text "address" column with three separate
-- lines matching a normal postal address: street+number, postal code+city,
-- country. Existing single-line values are best-effort split on the first
-- comma (this project's only pre-existing rows use "street, postnr by") into
-- address_street/address_postal_city; there's no reliable way to recover a
-- country from the old data, so address_country is left null for existing
-- rows (shown as "—" in the UI, same as every other optional costumer field).
alter table public.costumers
  add column address_street text,
  add column address_postal_city text,
  add column address_country text;

update public.costumers
set
  address_street = nullif(trim(split_part(address, ',', 1)), ''),
  address_postal_city = case
    when position(',' in address) > 0
      then nullif(trim(substring(address from position(',' in address) + 1)), '')
    else null
  end
where address is not null;

alter table public.costumers drop column address;
