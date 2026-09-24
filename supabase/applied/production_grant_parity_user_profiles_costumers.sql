-- Production-only catch-up (applied 2026-09-24): brings production's table
-- grants on user_profiles and costumers in line with staging's. Production
-- was created without replaying the earlier "grant surgery" migrations
-- (costumers_add_twohire_credentials.sql, costumers_scope_twohire_client_id_to_fleetii_admin.sql,
-- and the user_profiles column-level UPDATE restriction), so it still had
-- Supabase's default table-wide grants. Consequences before this fix,
-- both confirmed on production in rolled-back transactions:
--   * any logged-in user could UPDATE their own user_profiles.role to
--     'sysadm' (or change their own costumer_id) — the RLS UPDATE policy
--     only restricts WHICH ROW, not which columns;
--   * any logged-in user could SELECT their own costumer's
--     twohire_client_id/twohire_client_secret.
-- Staging already had exactly these grants; this is a no-op there.
revoke all on public.user_profiles from anon, authenticated;
grant select, references, trigger on public.user_profiles to anon;
grant select, delete on public.user_profiles to authenticated;
-- The only client-side user_profiles write: switching one's own active
-- department (RLS policy user_profiles_update_own_department limits it to
-- the caller's own row and a department they're granted in user_departments).
grant update (department_id) on public.user_profiles to authenticated;

-- A plain column-level REVOKE can't override a table-wide GRANT SELECT (see
-- costumers_add_twohire_credentials.sql), so revoke table-wide and re-grant
-- every column except the two raw credential columns.
revoke select on public.costumers from anon, authenticated;
grant select (address_country, address_postal_city, address_street, contact_person, costumer_id,
  created_at, cvr, deactivated_at, email, has_twohire_client_id, has_twohire_client_secret,
  has_twohire_credentials, name, phone) on public.costumers to anon, authenticated;
