-- Adds SELECT and DELETE to costumer_orders (INSERT-only until now — see
-- costumer_orders_table.sql) for upcoming functionality that needs to list/
-- remove these requests. Same scoping as the existing INSERT policy: an
-- admin sees/deletes only their own costumer's orders, a FLEETii admin any.
--
-- Safe to re-run: GRANT/policy are idempotent.

grant select, delete on public.costumer_orders to authenticated;

drop policy if exists "costumer_orders_select_admin_own_costumer" on public.costumer_orders;
create policy "costumer_orders_select_admin_own_costumer" on public.costumer_orders
  for select
  to authenticated
  using (
    public.is_fleetii_admin()
    or (public.is_admin() and costumer_id = public.current_costumer_id())
  );

drop policy if exists "costumer_orders_delete_admin_own_costumer" on public.costumer_orders;
create policy "costumer_orders_delete_admin_own_costumer" on public.costumer_orders
  for delete
  to authenticated
  using (
    public.is_fleetii_admin()
    or (public.is_admin() and costumer_id = public.current_costumer_id())
  );
