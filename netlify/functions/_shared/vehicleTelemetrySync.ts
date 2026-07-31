// Shared helper: pushes a snapshot of dynamic data (position, battery) to a
// 2hire e2e-simulated device. Used both right after a fresh migration
// (2hire-migrate-vehicle.mts) and to retry/backfill an already-migrated
// vehicle whose initial push partially failed (2hire-resync-vehicle.mts) —
// factored out here so the two don't duplicate this logic. Does NOT touch
// lock state at all (an earlier version did) — see pushDynamicDataToTwoHire's
// own doc comment for why that was actively harmful, not just redundant.
import { sendGenericCommand, simulateTrip, updateBattery, type SimulatedTripPosition } from "./twoHireClient.js";
import { TWOHIRE_REFERENCE_TRIP } from "./twoHireReferenceTrip.js";

export type DynamicDataSnapshot = {
  lat: number | null;
  lng: number | null;
  autonomy_percentage: number | null;
};

/**
 * Builds an approach trip ending exactly at (lat, lng) by translating
 * TWOHIRE_REFERENCE_TRIP — 2hire support's own confirmed-working test
 * payload, see that file's doc comment — so its LAST waypoint lands there,
 * preserving every other waypoint's offset relative to that last one
 * unchanged. This reuses the EXACT leg count/per-leg distances/curvature
 * already proven live (2026-07-31, CS30731) to deliver distance_covered/
 * autonomy_percentage via webhook (not just position), rather than guessing
 * at a new shape: a first attempt here used a synthetic 11-waypoint
 * straight-line approach (small ~30m steps) and delivered NOTHING at all —
 * not even position — over a full 5-minute wait, so rather than keep
 * guessing which constraint (leg count? total distance? straight-line vs.
 * curved path?) that violated, this sidesteps the question entirely by
 * reusing a payload already confirmed to work.
 */
function buildApproachTrip(lat: number, lng: number): SimulatedTripPosition[] {
  const last = TWOHIRE_REFERENCE_TRIP[TWOHIRE_REFERENCE_TRIP.length - 1];
  return TWOHIRE_REFERENCE_TRIP.map((point) => ({
    latitude: lat + (point.latitude - last.latitude),
    longitude: lng + (point.longitude - last.longitude),
  }));
}

/**
 * Pushes `snapshot` to the e2e-simulated device identified by `identifier`
 * (vehicle_profiles.iot_id — NOT the 2hire vehicleId). Never throws —
 * returns a combined warning message (semicolon-joined) if anything failed,
 * or null if everything succeeded, so a partial failure here never blocks
 * whatever already-successful step the caller is on.
 *
 * 2hire's own devices start out LOCKED by default and refuse simulateTrip
 * entirely while locked (confirmed live: {success:false,
 * cause:"VEHICLE_LOCKED"}) — unlocked first via a real "start" command so
 * the position push can actually succeed.
 *
 * Deliberately does NOT also sync `snapshot.locked` back to 2hire afterward
 * (an earlier version of this function did) — confirmed live (2026-07-31,
 * CS30731, twice) that immediately sending a "stop" (lock) command right
 * after the trip silently kills webhook delivery entirely: two separate
 * approach-trip designs, including one using the exact confirmed-working
 * TWOHIRE_REFERENCE_TRIP shape, both delivered NOTHING (not even position)
 * over a full 5-minute wait — while the standalone diagnostic
 * (2hire-test-trip.mts), which never sends a lock command afterward,
 * reliably delivered everything both times it was tried. Leaving 2hire's
 * own device unlocked after a migration/resync push is harmless: real
 * lock/unlock actions (set-vehicle-lock.mts) always send an absolute
 * "start"/"stop" command based on the desired NEW state, never a toggle
 * dependent on 2hire's prior state, so whatever this leaves 2hire's
 * simulator in gets overridden the next time anyone actually locks/unlocks
 * the vehicle for real.
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
      await simulateTrip(identifier, buildApproachTrip(snapshot.lat, snapshot.lng));
    } catch (error) {
      warning = error instanceof Error ? error.message : "Ukendt fejl ved overførsel af position.";
    }
  }

  // Called AFTER the trip above so this value is at least the STARTING
  // point 2hire's simulator computes from — it does NOT survive perfectly
  // though: confirmed live (2026-07-31, resyncing all 4 backfill vehicles)
  // that the approach trip's own simulated battery drain applies a further,
  // consistent ~17-percentage-point deduction on top of whatever this call
  // sets (e.g. BI47381 95%->78%, BK80675 69%->52%) before the final value
  // reaches the webhook — same total distance/shape every time, hence the
  // same drain amount. Accepted as an approximation (user's call,
  // 2026-07-31), not something we try to compensate for by pushing a higher
  // value. distance_covered has no override at all — it has no settable
  // field anywhere in 2hire's API — so a vehicle's real historical
  // distance_covered_meters gets fully overwritten by the approach trip's
  // own (small, synthetic) computed distance, unrelated to the real value.
  // Also an accepted tradeoff, not a bug — real position, on the other
  // hand, DOES land exactly right (confirmed against the original backup
  // CSV) since it's the trip's literal endpoint, not something 2hire
  // derives.
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
