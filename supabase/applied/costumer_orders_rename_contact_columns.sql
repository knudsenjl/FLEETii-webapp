-- Renames costumer_orders.kontaktperson/kontaktnummer to English column
-- names (contactperson/contactnumber), matching this DB's own convention of
-- English column names regardless of the Danish UI labels/form field names
-- (see e.g. costumers.contact_person/phone for the same pattern elsewhere).
--
-- Safe to re-run: IF EXISTS guards make a second run a no-op once renamed.

alter table public.costumer_orders rename column kontaktperson to contactperson;
alter table public.costumer_orders rename column kontaktnummer to contactnumber;
