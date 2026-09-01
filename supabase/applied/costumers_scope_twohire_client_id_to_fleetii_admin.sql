-- Tightens twohire_client_id to FLEETii-admin-only, matching the actual
-- intent behind exposing it in the first place (CostumerDetailsPage.tsx's
-- "/costumer-details/:costumerId" route, gated by ProtectedRoute
-- requireRole="FLEETii admin" in App.tsx -- no other page reads this raw
-- column). costumers_expose_twohire_client_id.sql granted it table-wide to
-- anon AND authenticated on the reasoning that an OAuth2 client_id is
-- "semi-public, like name/cvr/address" -- true in general, but that grant
-- combined with departments_costumers_select_scope_costumer.sql's row-level
-- policy (is_fleetii_admin() OR costumer_id = current_costumer_id()) meant
-- any of that costumer's OWN users -- an ordinary "admin" or "user" role,
-- not just FLEETii admin -- could read it via a direct Supabase REST call,
-- and the anon half of the grant was dead weight since no RLS policy on
-- this table gives anon any row visibility at all.
--
-- Column-level GRANTs can't be conditioned on is_fleetii_admin() -- Postgres
-- roles are static, and "FLEETii admin" is an app-level user_profiles.role,
-- not a separate DB role (every browser session is just `authenticated`).
-- RLS's row-level `using` can call that function, but can't restrict one
-- column differently from the rest of the row. So the raw value is pulled
-- out from under the plain column-select entirely (matching
-- twohire_client_secret's own revoke, see costumers_add_twohire_credentials.sql)
-- and served through a SECURITY DEFINER function instead, which re-checks
-- is_fleetii_admin() itself on every call regardless of the row's own RLS
-- outcome. has_twohire_client_id (the presence-only boolean) is untouched --
-- still readable table-wide, same as has_twohire_client_secret.
revoke select (twohire_client_id) on public.costumers from anon, authenticated;

create or replace function public.get_twohire_client_id(p_costumer_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select twohire_client_id
  from public.costumers
  where costumer_id = p_costumer_id
    and public.is_fleetii_admin();
$$;

grant execute on function public.get_twohire_client_id(uuid) to authenticated;
