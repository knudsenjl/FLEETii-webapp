-- Adds user_ident (text, nullable) to user_profiles — a company-wide
-- "Ansat-ID" identifier, distinct from email, that a FLEETii/regular admin
-- can optionally set per user (UserDetailsPage.tsx). Wherever the app
-- previously showed "Bruger" as a specific person's read-only display
-- identifier (not the role label "Bruger" = regular user, which is
-- unaffected), it now shows "Ansat-ID" instead, falling back to email when
-- user_ident is null/empty. No RLS/grant changes needed — user_profiles'
-- existing SELECT/UPDATE policies are row-scoped, not column-scoped, so
-- they already cover this new column.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.

alter table public.user_profiles add column if not exists user_ident text;
