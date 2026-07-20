-- Converts public.costumer.costumer_id's type to uuid (name unchanged).
-- No file in this repo creates or references a "costumer" table at all
-- (confirmed via a full-repo search) — it must have been created directly
-- in the Supabase dashboard/SQL editor, so its current id type/data is
-- unknown here. Guarded so it's safe to re-run.
--
-- IMPORTANT — read before running: if costumer_id is currently an
-- integer/bigint identity column (as vehicle_log.id turned out to be —
-- see vehicle_log_id_to_uuid.sql) and the table already has rows,
-- converting via `USING gen_random_uuid()` assigns each EXISTING row a
-- brand new, unrelated uuid — the original numeric ids are permanently
-- lost. Since nothing in this codebase references this table, that's only
-- a concern if something outside this codebase depends on the old values.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'costumer'
      and column_name = 'costumer_id' and data_type <> 'uuid'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'costumer'
        and column_name = 'costumer_id' and is_identity = 'YES'
    ) then
      alter table public.costumer alter column costumer_id drop identity;
    end if;

    alter table public.costumer alter column costumer_id drop default;
    alter table public.costumer alter column costumer_id type uuid using gen_random_uuid();
    alter table public.costumer alter column costumer_id set default gen_random_uuid();
  end if;
end $$;
