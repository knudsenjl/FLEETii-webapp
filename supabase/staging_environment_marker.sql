-- STAGING ONLY — NEVER run this on production.
--
-- Marks this database as the staging database. The test-data seed Functions
-- (netlify/functions/_shared/testDataGuard.ts, check 3) call
-- fleetii_is_staging_database() right before writing simulated data and
-- refuse unless it returns true. Production has no such function, so the
-- call fails there and nothing is written — a guard that lives in the
-- database itself, independent of any Netlify setting.
--
-- Callable only by the service role (the seed Functions), not by app users.

create or replace function public.fleetii_is_staging_database()
returns boolean
language sql
immutable
as $$ select true $$;

revoke all on function public.fleetii_is_staging_database() from public, anon, authenticated;
grant execute on function public.fleetii_is_staging_database() to service_role;
