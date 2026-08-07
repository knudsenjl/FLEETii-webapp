-- Per-costumer 2hire production sub-account credentials — see the
-- "Per-costumer 2hire credentials" plan. Nullable: only meaningful once
-- production 2hire is live; test mode always uses the global
-- TWOHIRE_CLIENT_ID/SECRET env vars regardless of these columns (see
-- netlify/functions/_shared/twoHireCredentials.ts).
--
-- Written only from CostumerDetailsPage.tsx's edit form (FLEETii admin,
-- via the existing costumers_update_fleetii_admin RLS policy — no new
-- policy needed, it already covers every column). Read back only by
-- Netlify Functions via the service-role key, which bypasses RLS/grants
-- entirely — the grant surgery below is what actually keeps a regular
-- admin/user's anon-key session from ever reading another costumer's (or
-- even their own) client_secret, since costumers' own SELECT RLS is
-- otherwise wide open (`costumers_select_authenticated`, qual: true) for
-- every other column.
--
-- A plain column-level REVOKE alone does NOT work here: in Postgres,
-- table-level and column-level ACLs are independent, and access is
-- granted if EITHER permits it — so a pre-existing table-wide
-- `GRANT SELECT ON TABLE costumers` (which this table already has, for
-- anon/authenticated) keeps covering every column regardless of any
-- column-level REVOKE layered on top. The only way to genuinely restrict
-- specific columns is to revoke the table-wide SELECT and re-grant it at
-- the column level for every column EXCEPT the two secrets.
alter table public.costumers
  add column twohire_client_id text,
  add column twohire_client_secret text;

revoke select on public.costumers from anon, authenticated;

grant select (
  costumer_id, created_at, name, deactivated_at, cvr, contact_person, phone,
  email, address_street, address_postal_city, address_country
) on public.costumers to anon, authenticated;
