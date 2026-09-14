-- Fixes add_standard_interval_range_check.sql's constraint being too
-- narrow: Standard_interval is actually a "select" in StandardSettings.tsx
-- with exactly 5 fixed options ("00"/"15"/"30"/"45"/"60" — start now, or
-- round up to the next quarter-hour/hour), not a free-typed "number" input.
-- The original migration's 1-59 range was copied from a DIFFERENT setting's
-- own bounds (Session_timeout, a genuine free-typed number field) by
-- mistake, silently rejecting the two endpoint options ("00" and "60") the
-- UI itself has always offered as real, meaningful choices. Confirmed via a
-- live check before writing this: no row in either table has EVER held
-- "00" or "60" for this setting — this bug predates any UI code path that
-- would have exercised it (surfaced by SettingsUserPage.tsx's new
-- deferSave "Opdater" flow being the first thing to actually try saving
-- "00").
--
-- Widening an existing range check can't make already-valid data invalid,
-- so (unlike the original migration) there's no need to pre-clean any row
-- first.
--
-- Safe to re-run: constraint dropped before recreated.

alter table public.department_settings drop constraint if exists department_settings_standard_interval_range;
alter table public.department_settings add constraint department_settings_standard_interval_range
  check (
    name <> 'Standard_interval'
    or value_text is null
    or (value_text ~ '^[0-9]{1,2}$' and value_text::int between 0 and 60)
  );

alter table public.user_settings drop constraint if exists user_settings_standard_interval_range;
alter table public.user_settings add constraint user_settings_standard_interval_range
  check (
    name <> 'Standard_interval'
    or value_text is null
    or (value_text ~ '^[0-9]{1,2}$' and value_text::int between 0 and 60)
  );
