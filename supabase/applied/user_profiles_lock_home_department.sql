-- STEP B of splitting "home department" from "active department" (step A:
-- user_profiles_add_active_department_id.sql). Run on each environment only
-- AFTER the code that switches via active_department_id is deployed there —
-- older code switches department by updating department_id and would be
-- refused once this has run.
--
-- The Hjemmeafdeling (department_id) is no longer something a user changes
-- by using the Data Filter: only create-user/update-user/bulk import (all
-- service-role) set it. So authenticated loses UPDATE on department_id and
-- keeps only active_department_id, and the self-update policy no longer
-- needs the department_id condition.
--
-- Safe to re-run.

revoke update (department_id) on public.user_profiles from authenticated;

alter policy "user_profiles_update_own_department" on public.user_profiles
  with check (
    auth.uid() = user_id
    and (
      active_department_id is null
      or exists (
        select 1 from public.user_departments ud
        where ud.user_id = user_profiles.user_id and ud.department_id = user_profiles.active_department_id
      )
    )
  );
