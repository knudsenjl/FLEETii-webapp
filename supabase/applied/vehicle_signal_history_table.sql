-- Append-only history of every 2hire generic signal delivery, kept
-- alongside (not instead of) vehicle_signals — see that table's own
-- doc comment for why it stays a plain current-state row per vehicle_id
-- rather than becoming a log itself. This table exists purely so future
-- statistics/reporting has a full timeline to work from, not just "now".
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Safe to run more than once (CREATE TABLE IF NOT EXISTS, policy dropped
-- before being recreated).
--
-- Deliberately generic (signal_type/signal_value) rather than one fixed
-- column per known signal: 2hire's webhook subscription is a wildcard
-- ("vehicle:*:generic:*", see 2hire-subscribe.mts), and there are more
-- generic signal types than the four vehicle_signals currently tracks live
-- (online/position/distance_covered/autonomy_percentage — see
-- toColumnUpdate() in 2hire-webhook.mts). A fixed-column history table
-- would need a migration every time 2hire added a new one; this shape
-- captures ANY signal 2hire ever sends with zero schema changes.
-- signal_value holds 2hire's own payload.data object as-is (jsonb) — no
-- translation, so nothing is lost even for a signal type this codebase
-- doesn't otherwise recognize yet.
--
-- Surrogate uuid primary key (not vehicle_id) since, unlike
-- vehicle_signals, this table is expected to accumulate many rows per
-- vehicle over time — same shape as costumer_purge_log's own append-only
-- log pattern (costumer_purge_function.sql).
--
-- Context: netlify/functions/2hire-webhook.mts is the only writer, using
-- the service-role key (bypasses RLS) after validating 2hire's webhook
-- signature. No INSERT/UPDATE/SELECT policy is defined here at all —
-- unlike vehicle_signals (current state, readable by any authenticated
-- FLEETii user for the live UI), there's no reader for this yet, so it
-- stays service-role-only until a stats feature actually needs to query it
-- from the browser, at which point add a scoped SELECT policy then.

create table if not exists public.vehicle_signal_history (
  vehicle_signal_history_id uuid not null default gen_random_uuid() primary key,
  vehicle_id uuid not null references public.vehicle_profiles(vehicle_id),
  signal_type text not null,
  signal_value jsonb not null,
  signal_timestamp timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists vehicle_signal_history_vehicle_id_timestamp_idx
  on public.vehicle_signal_history (vehicle_id, signal_timestamp);
create index if not exists vehicle_signal_history_signal_type_timestamp_idx
  on public.vehicle_signal_history (signal_type, signal_timestamp);

alter table public.vehicle_signal_history enable row level security;
