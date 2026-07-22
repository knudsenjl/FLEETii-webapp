-- Renames public.costumer to public.costumers. No app code references this
-- table at all (confirmed via a full-repo search), so this is a pure DB
-- rename with no code-side changes needed. Postgres automatically updates
-- dependent objects (departments.costumer_id's foreign key, any indexes/
-- constraints on the table itself) to point at the new name — no separate
-- fixup needed for those.
--
-- Safe to re-run: guarded, no-ops if already renamed.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'costumer'
  ) then
    alter table public.costumer rename to costumers;
  end if;
end $$;
