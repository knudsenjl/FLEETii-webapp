-- Exposes WHETHER a costumer's 2hire credentials are set, without exposing
-- the raw values -- twohire_client_id/twohire_client_secret stay SELECT-
-- revoked from anon/authenticated (see costumers_add_twohire_credentials.sql).
-- Purely informational: used by CostumerAdministrationPage.tsx's "Mangler
-- 2hire registrering" badge and CostumerDetailsPage.tsx's edit-mode
-- "Konfigureret"/"Ikke konfigureret" indicator. Deliberately NOT used to
-- gate the costumer-creation draft-registration screen (see
-- CostumerDetailsPage.tsx's own pendingTwoHireRegistration state, which is
-- seeded from router state instead) -- every costumer that predates
-- per-costumer 2hire credentials legitimately has this as false and must
-- not be misread as "registration still in progress" when merely revisited.
--
-- A generated column's grants behave like any other column's for Postgres
-- ACL purposes, so this reuses the exact same revoke-table/re-grant-per-
-- column pattern costumers_add_twohire_credentials.sql already established
-- -- just adding this one new column to what's exposed, not touching the
-- existing re-grant list.
alter table public.costumers
  add column has_twohire_credentials boolean
  generated always as (twohire_client_id is not null and twohire_client_secret is not null) stored;

grant select (has_twohire_credentials) on public.costumers to anon, authenticated;
