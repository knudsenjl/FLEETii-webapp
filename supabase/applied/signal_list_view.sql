-- public.signal_list: a small convenience view listing every DISTINCT
-- signal_type ever recorded in vehicle_signal_history — e.g. for spot-
-- checking which 2hire signal types (and any FLEETii-authored ones like
-- "lock"/"unlock"/"locked", see set-vehicle-lock.mts) have actually been
-- seen in a given environment, without hand-writing the same query each
-- time. Created ad hoc directly on Production (2026-09-05); this migration
-- brings it into the codebase and onto Staging too.
--
-- WITH (security_invoker = true) fixes the one real issue with the ad hoc
-- version: without it, a view runs with the privileges of whoever created
-- it (typically a superuser-like role in the SQL editor), which BYPASSES
-- vehicle_signal_history's RLS entirely (that table is
-- enabled-RLS-no-policy, i.e. service-role-only by design — see
-- vehicle_signal_history_table.sql's own "stays service-role-only until a
-- stats feature actually needs to query it from the browser" comment) —
-- flagged by Supabase's security advisor as a SECURITY DEFINER VIEW ERROR.
-- security_invoker = true (Postgres 15+, same fix as vehicle_signals'
-- compatibility view — see vehicle_signals_to_narrow_schema.sql) makes the
-- view transparent instead: it enforces whatever RLS the QUERYING role
-- actually has on vehicle_signal_history, same as querying that table
-- directly. Since there's still no SELECT policy on that table, this view
-- correctly returns nothing for anon/authenticated — only a service-role
-- caller (e.g. a Netlify Function, or the Supabase SQL editor itself) sees
-- real data, matching vehicle_signal_history's own access model exactly.
-- If a future feature needs this from the browser, add a real SELECT
-- policy to vehicle_signal_history itself (per that file's own comment) —
-- don't work around it by making this view SECURITY DEFINER again.
--
-- Run this in the Supabase SQL editor. Safe to re-run: CREATE OR REPLACE
-- VIEW.

create or replace view public.signal_list
with (security_invoker = true) as
select distinct signal_type
from public.vehicle_signal_history;
