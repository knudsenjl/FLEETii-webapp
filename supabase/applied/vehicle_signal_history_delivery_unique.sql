-- Adds a uniqueness constraint on (vehicle_id, signal_type, signal_timestamp)
-- to vehicle_signal_history, and switches 2hire-webhook.mts's history write
-- from a plain INSERT to an upsert that silently ignores a conflicting row
-- instead of adding a second copy of it.
--
-- Context (2026-09-10/11): the same underlying investigation that found
-- 2hire's webhook delivering duplicate webhook subscriptions (see
-- 2hire-subscribe.mts's unsubscribe-before-resubscribe fix) also confirmed
-- 2hire itself sends every signal reading TWICE per event, seconds apart,
-- with the exact same signal_timestamp both times — this is apparently
-- 2hire's own send-twice-for-reliability dispatch design, not a bug on our
-- side, and isn't going away just because the subscription-duplication bug
-- was fixed. vehicle_signals_latest (the "current state" table) already
-- discards the second copy correctly via upsert_vehicle_signal_if_newer()'s
-- strict-newer-timestamp guard, but vehicle_signal_history had no such
-- guard at all — every single delivery, duplicate or not, got its own row,
-- silently doubling this append-only table's growth rate. Since
-- vehicle_signal_history has no retirement/pruning procedure yet (flagged
-- as a known future need, not solved here), halving its growth rate now is
-- worth doing on its own regardless of when pruning gets built.
--
-- Real, distinct readings for the same vehicle+signal essentially never
-- share the exact same millisecond signal_timestamp (every observed
-- delivery cadence in production logs has been at least whole seconds
-- apart) — so this constraint only ever catches genuine duplicate
-- deliveries, never two legitimately different readings.
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Safe to run more than once (constraint dropped before being recreated) —
-- NOT safe to run if the table already contains true duplicate rows for the
-- same (vehicle_id, signal_type, signal_timestamp): the ADD CONSTRAINT step
-- will fail until those are de-duplicated first. As of this writing the
-- table is young enough (created 2026-08-03) that this hasn't been checked
-- for; if the ADD CONSTRAINT below errors with a uniqueness violation, run
--   delete from vehicle_signal_history a using vehicle_signal_history b
--   where a.ctid < b.ctid
--     and a.vehicle_id = b.vehicle_id
--     and a.signal_type = b.signal_type
--     and a.signal_timestamp = b.signal_timestamp;
-- first, then re-run this migration.

alter table public.vehicle_signal_history
  drop constraint if exists vehicle_signal_history_delivery_unique;

alter table public.vehicle_signal_history
  add constraint vehicle_signal_history_delivery_unique
  unique (vehicle_id, signal_type, signal_timestamp);
