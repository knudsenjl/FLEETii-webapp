-- STEP A of splitting "home department" from "active department"
-- (2026-09-24). Run on each environment BEFORE the code that uses
-- active_department_id is deployed there; step B
-- (user_profiles_lock_home_department.sql) follows AFTER that deploy.
--
-- Until now user_profiles.department_id was BOTH the user's Hjemmeafdeling
-- (UserDetailsPage, create-user/update-user) AND the department currently
-- selected in the Data Filter, which RLS uses via current_department_id().
-- An admin switching department therefore silently overwrote their own home
-- department, and the next login started in whatever department they last
-- looked at.
--
-- From now on (admins and regular users; a sysadm keeps using
-- department_id/costumer_id as a pure Data Filter scope pointer via
-- switch-department.mts — a sysadm has no home department):
--   * department_id        = the fixed Hjemmeafdeling, only changed via
--                            create-user/update-user/bulk import.
--   * active_department_id = the department selected in the Data Filter;
--                            null means "the home department". Cleared again
--                            on every explicit login (LoginPage.tsx).
--
-- current_department_id() — the single definition of "the caller's active
-- department" behind every RLS policy (bookings, department_settings,
-- vehicle_profiles, user_settings, user_profiles) — now returns
-- active_department_id when set AND still granted in user_departments,
-- otherwise department_id. The grant re-check means a revoked department
-- stops counting as active immediately, not only at the next login.
--
-- Safe to re-run.

alter table public.user_profiles
  add column if not exists active_department_id uuid
  references public.departments(department_id) on delete set null;

comment on column public.user_profiles.active_department_id is
  'Department currently selected in the Data Filter (admins/users); null = the home department (department_id). Reset to null on every explicit login. Not used for sysadm.';

create or replace function public.current_department_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select up.active_department_id
      where up.active_department_id is not null
        and exists (
          select 1 from public.user_departments ud
          where ud.user_id = up.user_id and ud.department_id = up.active_department_id
        )),
    up.department_id
  )
  from public.user_profiles up
  join public.costumers c on c.costumer_id = up.costumer_id
  where up.user_id = auth.uid()
    and up.deleted_at is null
    and c.deactivated_at is null;
$$;

-- Users switch their own active department directly (AuthContext.tsx's
-- switchDepartment), so authenticated may update this one column.
grant update (active_department_id) on public.user_profiles to authenticated;

-- Own row only, and the active department must be one of the user's own
-- user_departments grants (or null = home). The department_id condition is
-- the pre-existing one, kept until step B so the still-deployed older code
-- (which switches by updating department_id) stays exactly as restricted
-- as before during the deploy window.
alter policy "user_profiles_update_own_department" on public.user_profiles
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.user_departments ud
      where ud.user_id = user_profiles.user_id and ud.department_id = user_profiles.department_id
    )
    and (
      active_department_id is null
      or exists (
        select 1 from public.user_departments ud
        where ud.user_id = user_profiles.user_id and ud.department_id = user_profiles.active_department_id
      )
    )
  );
