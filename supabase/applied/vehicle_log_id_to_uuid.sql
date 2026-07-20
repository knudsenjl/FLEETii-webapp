-- Renames public.vehicle_log's "id" column to "log_id" and converts its
-- type to uuid. No file in this repo creates or references vehicle_log at
-- all (confirmed via a full-repo search) — it must have been created
-- directly in the Supabase dashboard/SQL editor, so its current id
-- type/data is unknown here. Both steps below are guarded so this is safe
-- to re-run.
--
-- IMPORTANT — read before running: if "id" is currently an integer/bigint
-- (e.g. a serial primary key) and the table already has rows, converting
-- to uuid via `USING gen_random_uuid()` assigns each EXISTING row a brand
-- new, unrelated UUID — the original id values are permanently lost (not
-- recoverable from this migration). That's fine if the table is empty or
-- nothing outside this database references those old numeric ids. If
-- vehicle_log already has rows that matter, or something else keys off
-- its old id values, stop before running this and let's write a
-- value-preserving migration instead.
--
-- Renaming a column that's part of a primary key does not require
-- dropping/recreating the constraint — Postgres updates it automatically
-- — so no constraint handling is needed here.

-- 1. Convert id's type to uuid, only if it isn't already.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicle_log'
      and column_name = 'id' and data_type <> 'uuid'
  ) then
    -- Identity columns (GENERATED ... AS IDENTITY) can't just have their
    -- default dropped like a plain serial's — Postgres requires DROP
    -- IDENTITY explicitly, and an identity column must stay an integer
    -- type anyway, so it has to go before the type can become uuid.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vehicle_log'
        and column_name = 'id' and is_identity = 'YES'
    ) then
      alter table public.vehicle_log alter column id drop identity;
    end if;

    alter table public.vehicle_log alter column id drop default;
    alter table public.vehicle_log alter column id type uuid using gen_random_uuid();
    alter table public.vehicle_log alter column id set default gen_random_uuid();
  end if;
end $$;

-- 2. Rename id -> log_id, only if "id" still exists (so this no-ops if
--    already renamed by a previous run).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicle_log' and column_name = 'id'
  ) then
    alter table public.vehicle_log rename column id to log_id;
  end if;
end $$;
