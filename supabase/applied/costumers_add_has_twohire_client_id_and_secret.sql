-- Per-field companions to has_twohire_credentials (which is the AND of
-- both -- fine for a single "missing registration" list badge, but not
-- precise enough for CostumerDetailsPage.tsx's edit form: an admin who set
-- the client ID but forgot the secret (or vice versa) deserves to see WHICH
-- one is missing, not just "not configured". Never exposes the raw values
-- -- twohire_client_id/twohire_client_secret stay SELECT-revoked from
-- anon/authenticated (see costumers_add_twohire_credentials.sql).
alter table public.costumers
  add column has_twohire_client_id boolean generated always as (twohire_client_id is not null) stored,
  add column has_twohire_client_secret boolean generated always as (twohire_client_secret is not null) stored;

grant select (has_twohire_client_id, has_twohire_client_secret) on public.costumers to anon, authenticated;
