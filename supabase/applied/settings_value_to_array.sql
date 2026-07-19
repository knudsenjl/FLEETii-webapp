-- ARCHIVED: already applied to the live database. Kept only as a historical
-- record of why settings.value is text[] not text — not needed to reproduce
-- the current schema (see the files directly under supabase/ for that).
--
-- One-time migration: converts settings.value from a comma-separated text
-- string to a real text[] array, splitting (and trimming) each existing
-- value on "," so e.g. "Kundebesøg, Levering, Andet (angiv årsag)" becomes
-- {Kundebesøg,Levering,Andet (angiv årsag)}.
--
-- Guarded so it's safe to re-run once already converted.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settings'
      and column_name = 'value' and data_type <> 'ARRAY'
  ) then
    alter table public.settings
      alter column value type text[]
      using regexp_split_to_array(trim(value), '\s*,\s*');
  end if;
end $$;
