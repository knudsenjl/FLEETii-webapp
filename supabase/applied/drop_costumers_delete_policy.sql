-- Drops costumers_delete_fleetii_admin (added by costumers_update_delete_
-- policy.sql), found vestigial in code review: CostumerDetailsPage.tsx no
-- longer does a direct client-side `.from("costumers").delete()` — "Slet
-- kunden permanent" now goes through delete-costumer.mts's gated purge flow
-- (requires the costumer already blocked + a typed name confirmation,
-- neither of which RLS can express). Leaving this policy in place meant a
-- FLEETii admin could still bypass both of those checks entirely via a raw
-- `supabase.from("costumers").delete(...)` call from the browser console —
-- it would almost always fail with a foreign-key violation in practice
-- (departments/user_profiles still reference the row), but that's not a
-- safety mechanism, just an accident of the schema having no cascades.
--
-- Deleting a costumer now only ever happens inside purge_costumer (SQL,
-- SECURITY DEFINER, execute revoked from anon/authenticated — see
-- costumer_purge_function.sql), which bypasses RLS entirely and needs no
-- policy here at all.
--
-- Safe to re-run: guarded by IF EXISTS.

drop policy if exists "costumers_delete_fleetii_admin" on public.costumers;
