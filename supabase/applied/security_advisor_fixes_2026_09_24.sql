-- Fixes from Supabase's security advisor (2026-09-24 code review) — a
-- follow-up to the older security_advisor_fixes.sql, not a replacement:
--
-- 1. function_search_path_mutable: touch_users_updated_at had no pinned
--    search_path (every other function here already sets one).
-- 2. anon_security_definer_function_executable: the SECURITY DEFINER helper
--    and trigger functions below were executable by the `anon` role (via
--    PUBLIC and Supabase's default privileges), i.e. callable through
--    /rest/v1/rpc/... without logging in. None of them is meant for anon:
--    every RLS policy that uses them applies to `authenticated` only, and
--    the app makes no database calls before login. RLS helpers stay granted
--    to authenticated; trigger functions are revoked from it too.
-- 3. Staging only had user_settings_select_own_or_admin_own_department
--    applying to role PUBLIC (production: authenticated) — aligned, so an
--    anonymous request can't hit a policy whose helper functions it may no
--    longer execute.
--
-- Safe to re-run.

alter function public.touch_users_updated_at() set search_path = public;

-- RLS helpers: needed by logged-in users (the policies call them), never by anon.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.current_costumer_id()',
    'public.current_department()',
    'public.current_department_id()',
    'public.current_email()',
    'public.get_twohire_client_id(uuid)',
    'public.is_admin()',
    'public.is_setting_tilladt(text, uuid, uuid)',
    'public.is_sysadm()',
    'public.user_belongs_to_costumer(uuid, uuid)'
  ] loop
    -- Not every function exists in both environments.
    continue when to_regprocedure(fn) is null;
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

-- Trigger / event-trigger functions: never meant to be called by anyone —
-- trigger firing isn't gated by the DML-issuing role's EXECUTE grant, so
-- revoking from authenticated too (as security_advisor_fixes.sql already did
-- for handle_new_user/handle_auth_user_email_change) only closes the direct
-- /rest/v1/rpc route. Verified on staging: a trigger still fires for an
-- authenticated insert after this revoke.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.enforce_user_settings_department_ceiling()',
    'public.handle_auth_user_email_change()',
    'public.handle_new_user()',
    'public.rls_auto_enable()',
    'public.seed_default_anvendelse_for_department()',
    'public.seed_default_ident_settings_for_department()'
  ] loop
    -- rls_auto_enable is production-only.
    continue when to_regprocedure(fn) is null;
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

alter policy "user_settings_select_own_or_admin_own_department" on public.user_settings to authenticated;
