-- Renames the auto-created default department every new costumer gets,
-- from "Alle afdelinger" to "Alle køretøjer" (costumers_create_default_department
-- trigger — see departments_unique_per_costumer_and_auto_create.sql).
-- No existing department is actually named "Alle afdelinger" today
-- (confirmed via diagnostic query this session — every real costumer's
-- department was renamed to a meaningful business name already), so this
-- only changes what future costumer creations will produce; nothing to
-- backfill.
--
-- Safe to re-run: CREATE OR REPLACE.

create or replace function public.create_default_department_for_costumer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.departments (name, costumer_id) values ('Alle køretøjer', new.costumer_id);
  return new;
end;
$$;
