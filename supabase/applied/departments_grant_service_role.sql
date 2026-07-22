-- Fixes "permission denied for table departments" (Postgres code 42501)
-- hit by update-user.mts's service-role lookup of a department by name —
-- confirmed via a debug log this session: service_role had no grants at
-- all on public.departments, even though every other table this session's
-- Netlify Functions touch (user_profiles, bookings, ...) already has
-- service_role's usual default full-access grant intact. Root cause is the
-- same as this session's earlier "renamed tables lost their grants" lesson
-- (see role_table_grants) — departments went through multiple PK swaps/
-- rebuilds this session (departments_department_name_pk.sql,
-- departments_department_id_pk.sql, ...), any of which could have reset
-- its grants without anyone noticing since only authenticated-role queries
-- (the browser client) had been exercised until now.
--
-- Safe to re-run: GRANT is idempotent.

grant select, insert, update, delete on public.departments to service_role;
