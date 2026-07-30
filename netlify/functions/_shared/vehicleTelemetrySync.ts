// Shared helper: pushes a snapshot of dynamic data (position, battery,
// lock state) to a 2hire e2e-simulated device and syncs the real 2hire
// vehicle's lock state to match. Used both right after a fresh migration
// (2hire-migrate-vehicle.mts) and to retry/backfill an already-migrated
// vehicle whose initial push partially failed (2hire-resync-vehicle.mts) —
// factored out here so the two don't duplicate this logic.
import { sendGenericCommand, simulateTrip, updateBattery } from "./twoHireClient.js";

export type DynamicDataSnapshot = {
  lat: number | null;
  lng: number | null;
  autonomy_percentage: number | null;
  locked: boolean | null;
};

/** Negligible (~1m) phantom starting offset for simulateTrip's first waypoint — two IDENTICAL waypoints satisfy its "at least 2 positions" requirement but still broadcast nothing (confirmed live, migrating BI47381): 2hire's interpolation needs an actual leg (real distance) to fire a signal over. This still lands the vehicle at its real recorded position (the second, un-offset waypoint). */
const POSITION_OFFSET_DEGREES = 0.00001;

/**
 * Pushes `snapshot` to the e2e-simulated device identified by `identifier`
 * (vehicle_profiles.iot_id — NOT the 2hire vehicleId), and syncs
 * `vehicleId`'s real 2hire lock state to match `snapshot.locked`. Never
 * throws — returns a combined warning message (semicolon-joined) if
 * anything failed, or null if everything succeeded, so a partial failure
 * here never blocks whatever already-successful step the caller is on.
 *
 * 2hire's own devices start out LOCKED by default and refuse simulateTrip
 * entirely while locked (confirmed live: {success:false,
 * cause:"VEHICLE_LOCKED"}) — unlocked first via a real "start" command so
 * the position push can actually succeed.
 */
export async function pushDynamicDataToTwoHire(
  vehicleId: string,
  identifier: string,
  snapshot: DynamicDataSnapshot,
): Promise<string | null> {
  let warning: string | null = null;

  if (snapshot.lat != null && snapshot.lng != null) {
    try {
      await sendGenericCommand(vehicleId, "start");
      await simulateTrip(identifier, [
        { latitude: snapshot.lat + POSITION_OFFSET_DEGREES, longitude: snapshot.lng },
        { latitude: snapshot.lat, longitude: snapshot.lng },
      ]);

      // Testing a hypothesis (2026-07-30): 2hire's own getDeviceState showed
      // the correct pushed position/battery immediately after this trip, but
      // vehicle_signals never received a webhook update for several of these
      // vehicles even after waiting well past the trip's interpolation
      // window — status stayed "MOVING". Theory: some signal types (at
      // least distance_covered/autonomy_percentage — already a known,
      // separately-tracked webhook-delivery gap) may only get flushed once a
      // vehicle actually STOPS, not while a trip is still interpolating. A
      // trailing single-waypoint "trip" at the exact same final position
      // settles the device instantly without moving it further (per
      // simulateTrip's own doc comment — a single-position call never
      // broadcasts a signal by itself, it just updates 2hire's internal
      // state immediately) — explicitly forcing it out of "MOVING" to see if
      // that unblocks whatever was queued.
      await simulateTrip(identifier, [{ latitude: snapshot.lat, longitude: snapshot.lng }]);
    } catch (error) {
      warning = error instanceof Error ? error.message : "Ukendt fejl ved overførsel af position.";
    }
  }

  // Whether or not there was a position to push, sync the real 2hire lock
  // state to match what's carried forward as vehicle_signals.locked
  // (defaults true/locked, matching set-vehicle-lock.mts's own "no row yet"
  // default) rather than leaving it at whatever 2hire defaulted a
  // freshly-registered device to (or at "unlocked" if the branch above just
  // ran a "start" command on it).
  try {
    await sendGenericCommand(vehicleId, snapshot.locked === false ? "start" : "stop");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl ved synkronisering af lås-status.";
    warning = warning ? `${warning}; ${message}` : message;
  }

  if (snapshot.autonomy_percentage != null) {
    try {
      await updateBattery(identifier, snapshot.autonomy_percentage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ukendt fejl ved overførsel af batteriniveau.";
      warning = warning ? `${warning}; ${message}` : message;
    }
  }

  return warning;
}
