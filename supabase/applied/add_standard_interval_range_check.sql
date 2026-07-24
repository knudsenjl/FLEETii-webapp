-- Defense-in-depth for code review finding: StandardSettings.tsx's
-- Standard_interval number input only had a cosmetic min/max (native
-- spinner styling, not enforced against a pasted/typed out-of-range value).
-- The client-side fix (StandardSettings.tsx's handleChange now rejects
-- anything outside 1-59 before saving) is the real fix; this CHECK
-- constraint is a backstop against any other write path (direct API call,
-- a future admin tool) saving a nonsensical interval.
--
-- Scoped to name = 'Standard_interval' only — value_text is a generic
-- column shared with 'Standard_varighed' ("HH:MM", not a plain integer),
-- so the constraint must not apply to every row in the table.
--
-- Postgres validates every EXISTING row against a new CHECK constraint, so
-- any Standard_interval row already saved out-of-range (exactly the bug this
-- migration is closing) would make the ALTER TABLE itself fail — reset any
-- such row to the component's own defaultValue ("15") first, so this can't
-- get stuck on the very data it's meant to prevent going forward.
--
-- Safe to re-run: constraint dropped before recreated.

update public.department_settings
set value_text = '15'
where name = 'Standard_interval'
  and value_text is not null
  and not (value_text ~ '^[0-9]{1,2}$' and value_text::int between 1 and 59);

update public.user_settings
set value_text = '15'
where name = 'Standard_interval'
  and value_text is not null
  and not (value_text ~ '^[0-9]{1,2}$' and value_text::int between 1 and 59);

alter table public.department_settings drop constraint if exists department_settings_standard_interval_range;
alter table public.department_settings add constraint department_settings_standard_interval_range
  check (
    name <> 'Standard_interval'
    or value_text is null
    or (value_text ~ '^[0-9]{1,2}$' and value_text::int between 1 and 59)
  );

alter table public.user_settings drop constraint if exists user_settings_standard_interval_range;
alter table public.user_settings add constraint user_settings_standard_interval_range
  check (
    name <> 'Standard_interval'
    or value_text is null
    or (value_text ~ '^[0-9]{1,2}$' and value_text::int between 1 and 59)
  );
