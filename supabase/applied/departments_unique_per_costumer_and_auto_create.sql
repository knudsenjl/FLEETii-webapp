-- Two related changes, both needed together:
--
-- 1. Swaps departments' uniqueness on "name" from global
--    (departments_name_key, UNIQUE (name)) to scoped per costumer
--    (UNIQUE (name, costumer_id)) — department names should only need to
--    be unique WITHIN a costumer, not across the whole table. The old
--    global constraint was added earlier this session (see
--    departments_department_id_pk.sql) purely so settings/user_profiles'
--    now-long-gone text-based department FKs had something to reference;
--    confirmed via a fresh constraint check that nothing references
--    departments(name) via foreign key anymore (bookings, settings, and
--    user_profiles all reference departments(department_id) directly), so
--    it's safe to drop outright rather than keep both.
--
-- 2. Adds a trigger so that every new row in costumers automatically gets
--    a matching "Alle afdelinger" department created for it — the
--    department a costumer starts with before any real departments are
--    added. Needs change #1 first: without it, a second costumer's
--    trigger-created "Alle afdelinger" department would collide with the
--    first one's under the old global-uniqueness constraint.
--
--    SECURITY DEFINER (with search_path pinned, same pattern as
--    is_admin()/current_department_id() in rls_policies.sql) so this
--    still works once costumers can be created from the webapp — the
--    trigger's own INSERT into departments needs to succeed regardless of
--    RLS on departments, which today only has a SELECT policy; without
--    SECURITY DEFINER, a future authenticated-role costumer insert would
--    fail this trigger with an RLS violation on the departments insert.
--
-- Safe to re-run: guarded/idempotent throughout.

-- 1. Swap the uniqueness constraint.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'departments_name_key' and conrelid = 'public.departments'::regclass
  ) then
    alter table public.departments drop constraint departments_name_key;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'departments_name_costumer_id_key' and conrelid = 'public.departments'::regclass
  ) then
    alter table public.departments add constraint departments_name_costumer_id_key unique (name, costumer_id);
  end if;
end $$;

-- 2. Auto-create a default department for every new costumer.
create or replace function public.create_default_department_for_costumer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.departments (name, costumer_id) values ('Alle afdelinger', new.costumer_id);
  return new;
end;
$$;

drop trigger if exists costumers_create_default_department on public.costumers;
create trigger costumers_create_default_department
  after insert on public.costumers
  for each row
  execute function public.create_default_department_for_costumer();
