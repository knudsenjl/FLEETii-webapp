-- Adds NOT NULL to bookings.vehicle_id and bookings.start, so the schema
-- actually enforces what BookingRow (src/lib/bookings.ts) already assumes
-- (vehicle_id: string, start: string — both non-nullable) and what
-- ConfirmPage.tsx's insert always provides. Found via a codebase-vs-schema
-- sync check (2026-07-19): both columns were nullable in the DB with no
-- code path relying on that, so tightening them just makes the schema
-- match reality instead of silently allowing something the app never does
-- and isn't written to handle.
--
-- "end" is deliberately left nullable — that's the real, intentional
-- open-ended-booking feature (see bookings_end_nullable.sql), not a gap.
--
-- Safe to re-run: guarded, no-ops if already NOT NULL. Will fail loudly
-- (not silently) if either column already has existing NULL rows — if
-- that happens, those rows need to be fixed or removed first; this
-- migration deliberately does not guess a default value to paper over
-- them.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name = 'vehicle_id' and is_nullable = 'YES'
  ) then
    alter table public.bookings alter column vehicle_id set not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name = 'start' and is_nullable = 'YES'
  ) then
    alter table public.bookings alter column start set not null;
  end if;
end $$;
