-- Fixes a gotcha found running add_costumer_contact_fields.sql: costumers
-- already had a "phone" column (bigint) predating any tracked migration —
-- same class of surprise as this schema's other dashboard-created tables —
-- so that migration's `add column if not exists phone text` silently
-- no-opped on it instead of creating a text column. Phone numbers aren't
-- numeric data (leading zeros, "+45" country codes, spaces/dashes are all
-- legitimate and a bigint can't represent them), and
-- CostumerDetailsPage.tsx's Tlf field writes an arbitrary string — this
-- would fail outright (non-numeric input) or silently mangle valid numbers
-- (leading zeros) against the bigint column.
--
-- `using phone::text` converts any existing bigint values to their text
-- form in place — safe, no data loss for what's there today.
--
-- Safe to re-run: ALTER COLUMN TYPE to the same type is a no-op on rerun.

alter table public.costumers alter column phone type text using phone::text;
