-- Lets any authenticated user read public.costumers (costumer_id, name),
-- so AuthContext.tsx's nested departments(costumers(name)) embed can
-- actually resolve instead of silently returning null. RLS was enabled on
-- this table with zero policies (confirmed via pg_policies returning no
-- rows) — the exact same gotcha settings_rls.sql and
-- departments_select_policy.sql were written to fix: RLS enabled + no
-- policy means every read returns nothing rather than an error, which is
-- why the SQL editor's own diagnostic query (postgres role, bypasses RLS)
-- showed correct data while the browser's authenticated-role request kept
-- coming back empty.
--
-- Open to any authenticated user (not admin-only) — costumer names aren't
-- sensitive, same reasoning as departments_select_policy.sql.
--
-- Safe to re-run: GRANT is idempotent, policy is dropped before recreated.

grant select on public.costumers to authenticated;

drop policy if exists "costumers_select_authenticated" on public.costumers;
create policy "costumers_select_authenticated" on public.costumers
  for select
  to authenticated
  using (true);
