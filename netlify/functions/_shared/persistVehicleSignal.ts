// Shared helper: writes one 2hire signal reading into both
// vehicle_signal_history (append-only) and vehicle_signals_latest (via
// upsert_vehicle_signal_if_newer, timestamp-guarded) — the same two-write
// pattern 2hire-webhook.mts uses inline for a live delivery, reused here for
// signals fetched directly via twoHireClient.ts's fetchGenericVehicleSignal/
// fetchSpecificVehicleSignal (e.g. right after 2hire-register-vehicle.mts
// registers a new vehicle, to seed current-state before any webhook
// delivery has happened for it). Unlike 2hire-webhook.mts, this always calls
// upsert_vehicle_signal_if_newer regardless of generic/specific — that
// function is signal-name-agnostic now (see
// upsert_vehicle_signal_if_newer_generic.sql), so there's no technical
// reason to withhold a specific signal like trip_detected from
// vehicle_signals_latest here, even though the webhook itself still doesn't
// (a deliberate, narrower choice made there, not a hard constraint).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TwoHireSignalReading } from "./twoHireClient.js";

export async function persistVehicleSignal(
  admin: SupabaseClient,
  vehicleId: string,
  signal: string,
  reading: TwoHireSignalReading,
): Promise<void> {
  const timestampIso = new Date(reading.timestampMs).toISOString();

  // History row first, unconditionally — same order as 2hire-webhook.mts, so
  // a failure on the "current state" write below can never leave a signal
  // with no history trace at all.
  const { error: historyError } = await admin.from("vehicle_signal_history").insert({
    vehicle_id: vehicleId,
    signal_type: signal,
    signal_value: reading.data,
    signal_timestamp: timestampIso,
  });
  if (historyError) throw new Error(`vehicle_signal_history (${signal}): ${historyError.message}`);

  const { error: rpcError } = await admin.rpc("upsert_vehicle_signal_if_newer", {
    p_vehicle_id: vehicleId,
    p_signal: signal,
    p_timestamp: timestampIso,
    p_data: reading.data,
  });
  if (rpcError) throw new Error(`upsert_vehicle_signal_if_newer (${signal}): ${rpcError.message}`);
}
