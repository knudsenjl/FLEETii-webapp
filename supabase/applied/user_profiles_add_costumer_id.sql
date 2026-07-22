-- Adds a nullable "costumer_id" uuid column to public.user_profiles, with
-- a foreign key to public.costumers(costumer_id). Existing rows are
-- populated by resolving through their current department_id ->
-- departments.costumer_id — value-preserving, not guessed, since this is
-- a real (if derived/denormalized) relationship: a user's costumer is
-- whichever costumer their department belongs to.
--
-- Rows with no department_id (or whose department has no costumer_id set)
-- are left with a null costumer_id rather than guessed.
--
-- Requires costumers.costumer_id to already be unique/primary key (it is
-- — see costumer_costumer_id_to_uuid.sql) for the foreign key to succeed.
--
-- Safe to re-run: guarded at each step.

-- 1. Add costumer_id uuid column if it doesn't already exist.
alter table public.user_profiles add column if not exists costumer_id uuid;

-- 2. Populate from the existing department_id -> departments.costumer_id link.
update public.user_profiles
set costumer_id = departments.costumer_id
from public.departments
where departments.department_id = user_profiles.department_id
  and user_profiles.costumer_id is null;

-- 3. Add the foreign key to costumers.costumer_id.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_costumer_id_fkey' and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_costumer_id_fkey
      foreign key (costumer_id) references public.costumers (costumer_id);
  end if;
end $$;
