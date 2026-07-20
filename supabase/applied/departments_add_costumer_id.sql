-- Adds a nullable "costumer_id" uuid column to public.departments, with a
-- foreign key to public.costumer(costumer_id). No default — a department
-- isn't required to belong to a costumer unless/until set.
--
-- Requires costumer.costumer_id to already be uuid and unique/primary key
-- for the foreign key to succeed (see costumer_costumer_id_to_uuid.sql —
-- run that first if you haven't already). If costumer.costumer_id isn't
-- unique/PK yet, the FK step below will fail loudly rather than silently
-- skip.
--
-- Safe to re-run: guarded at each step.

alter table public.departments
  add column if not exists costumer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'departments_costumer_id_fkey' and conrelid = 'public.departments'::regclass
  ) then
    alter table public.departments
      add constraint departments_costumer_id_fkey
      foreign key (costumer_id) references public.costumer (costumer_id);
  end if;
end $$;
