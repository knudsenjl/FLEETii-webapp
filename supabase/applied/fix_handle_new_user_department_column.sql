-- Fixes handle_new_user() — the AFTER INSERT trigger on auth.users that
-- pre-seeds a user_profiles row for every new signup — which still
-- referenced user_profiles.department, a column dropped by this session's
-- own user_profiles_department_to_department_id.sql migration and never
-- updated here. Every createUser() call has been crashing with a bare 500
-- ("column department does not exist" inside the trigger, rolling back the
-- whole auth.users insert — hence no auth.audit_log_entries row either,
-- since the entire transaction rolled back before GoTrue could log it).
--
-- department_id isn't set here at all (simply omitted, left NULL) —
-- create-user.mts's own upsert immediately after createUser() sets the
-- real department_id anyway (its header comment already anticipated this
-- trigger pre-seeding the row: "covers both the case where a DB trigger
-- already created the user_profiles row ... and the case where it
-- didn't"), so this trigger never needed to know the real department.
--
-- Safe to re-run: CREATE OR REPLACE.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    'user'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;
