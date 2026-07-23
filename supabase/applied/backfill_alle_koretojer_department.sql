-- Backfills the "Alle køretøjer" default department for every existing
-- costumer that doesn't already have one — costumers_create_default_department
-- (see departments_default_name_alle_koretojer.sql) only fires on new
-- costumer INSERTs, so costumers created before that trigger existed (or
-- before this session's rename from "Alle afdelinger") have no such
-- department at all. Without it, CostumerDetailsPage's "Slet kunde" guard
-- (which tells the admin to delete every OTHER department first, then
-- auto-removes "Alle køretøjer" itself) has nothing to preserve/auto-clean
-- for these costumers — harmless today (the costumer just ends up with
-- zero departments before delete, which still works), but inconsistent
-- with what every new costumer gets.
--
-- departments(name, costumer_id) is unique per costumer (not globally), so
-- this can't collide with any other costumer's own departments.
--
-- Safe to re-run: only inserts for costumers still missing the row.

insert into public.departments (name, costumer_id)
select 'Alle køretøjer', c.costumer_id
from public.costumers c
where not exists (
  select 1 from public.departments d
  where d.costumer_id = c.costumer_id and d.name = 'Alle køretøjer'
);
