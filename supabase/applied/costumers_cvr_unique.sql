-- CVR (Danish company registration number, "Det Centrale Virksomhedsregister")
-- uniquely identifies a company in the real world -- enforced here at the DB
-- level so two costumer records can never silently share one. Safe to apply
-- directly: as of this migration, staging had 5 costumers / 4 distinct
-- non-blank CVRs / 0 duplicates / 1 NULL, and production had 0 costumers.
-- A plain UNIQUE constraint (not a partial index) is sufficient because
-- CostumerDetailsPage.tsx's handleCreate/handleUpdate already normalize a
-- blank CVR input to NULL, never '' -- and Postgres never treats two NULLs
-- as equal under UNIQUE, so any number of costumers without a CVR yet stay
-- unaffected.
alter table public.costumers
  add constraint costumers_cvr_unique unique (cvr);
