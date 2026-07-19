-- ARCHIVED: already applied to the live database. Kept only as a historical
-- record of why the column is "brand" not "make" — not needed to reproduce
-- the current schema (see the files directly under supabase/ for that).
--
-- One-time migration: renames vehicle_profiles.make to brand.
-- Guarded so it's safe to re-run once already applied.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicle_profiles' and column_name = 'make'
  ) then
    alter table public.vehicle_profiles rename column make to brand;
  end if;
end $$;
