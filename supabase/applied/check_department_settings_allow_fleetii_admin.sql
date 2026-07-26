-- Confirms department_settings_allow_fleetii_admin.sql applied cleanly.

select polname, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as with_check_expr
from pg_policy
where polname in ('department_settings_insert_admin_own_department', 'department_settings_update_admin_own_department')
order by polname;
