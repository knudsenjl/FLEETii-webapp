-- Drops NOT NULL on settings.department, so a genuine global (department-
-- less) settings row can actually exist — matching what
-- src/lib/settings.ts's fetchSettingValue was already written to support
-- (an explicit `department: null` argument queries `.is("department",
-- null)` for a company-wide fallback row). Found via a codebase-vs-schema
-- sync check (2026-07-19): no caller currently passes `department: null`
-- explicitly, so this was latent rather than actively broken — but a
-- department-less account (e.g. a future "FLEETii admin" user) calling
-- isSettingTilladt would silently always get `false` instead of ever
-- finding a global row, since the DB couldn't hold one.
--
-- department turned out to be part of settings' primary key (name,
-- department) — a PK column can never be nullable, so it had to come out
-- of the PK entirely, not just have NOT NULL dropped.
--
-- Replaces that flat (name, department) key with THREE partial unique
-- indexes, one per tier of fetchSettingValue's actual precedence — a flat
-- (name, department) uniqueness doesn't account for user_id at all, which
-- is wrong in two directions: it would let a user-scoped row collide with
-- an unrelated department-scoped row sharing the same (name, department),
-- AND it would let two DIFFERENT users' override rows for the same
-- setting silently violate each other if they happened to share a
-- department value. The three tiers, matching settings.ts exactly:
--   1. user_id IS NOT NULL: fetchSettingValue's user-scoped lookup filters
--      only by (name, user_id), ignoring department entirely — so
--      uniqueness must be on (name, user_id) here, department is
--      irrelevant to this tier.
--   2. user_id IS NULL AND department IS NOT NULL: the department-scoped
--      row — unique on (name, department), same guarantee as the old PK
--      minus user_id ever being part of it (it couldn't be, PK columns
--      can't be nullable and user_id always was).
--   3. user_id IS NULL AND department IS NULL: the new global row — at
--      most one per name.
-- Each row falls into exactly one tier, so all three together fully
-- replace the old single key with no gaps.
--
-- Safe to re-run: every step guarded. Does not touch any existing row's
-- value (only reshapes constraints).

do $$
declare
  pk_name text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settings'
      and column_name = 'department' and is_nullable = 'NO'
  ) then
    select conname into pk_name
    from pg_constraint
    where conrelid = 'public.settings'::regclass and contype = 'p';

    if pk_name is not null then
      execute format('alter table public.settings drop constraint %I', pk_name);
    end if;

    alter table public.settings alter column department drop not null;
  end if;

  -- Drop the flat (name, department) unique constraint if an earlier run
  -- of this file already added it — it's superseded by the three partial
  -- indexes below.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.settings'::regclass
      and contype = 'u'
      and conname = 'settings_name_department_key'
  ) then
    alter table public.settings drop constraint settings_name_department_key;
  end if;
end $$;

create unique index if not exists settings_user_override_unique
  on public.settings (name, user_id)
  where user_id is not null;

create unique index if not exists settings_department_unique
  on public.settings (name, department)
  where user_id is null and department is not null;

create unique index if not exists settings_global_unique
  on public.settings (name)
  where user_id is null and department is null;
