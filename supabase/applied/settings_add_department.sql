-- ARCHIVED: already applied to the live database. Kept only as a historical
-- record of why settings has a "department" column — not needed to
-- reproduce the current schema (see the files directly under supabase/ for
-- that).
--
-- Adds a "department" column to settings, matching the text type used for
-- department elsewhere in this app (user_profiles.department,
-- bookings.department) — nullable, so existing app-wide settings rows
-- (no department = apply to everyone) keep working unchanged.
--
-- Safe to re-run (IF NOT EXISTS).

alter table public.settings add column if not exists department text;
