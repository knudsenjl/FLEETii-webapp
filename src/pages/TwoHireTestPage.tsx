import { motion } from "framer-motion";
import { use2hireGPS, use2hireVehicle } from "../contexts/VehicleContext";
import { shortSignalTimestamp } from "../lib/bookings";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { LeafletMap } from "../components/LeafletMap";
import { useVehicleLockState } from "../hooks/useVehicleLockState";
import { useTimedFlag } from "../hooks/useTimedFlag";

/**
 * Dedicated vehicle_profiles.vehicle_id for a copy of WB20418 (see
 * supabase/applied/seed_2hire_test_vehicle.sql), reused with NULL
 * costumer_id/department_id so it never shows up in any real customer's
 * fleet — this page always targets that one fixed vehicle, never a real
 * in-service one. This is also the real vehicleId 2hire's TEST adapter
 * assigned once WB20499 was actually registered as a simulated 2hire-board
 * device there (see supabase/applied/register_2hire_test_vehicle.sql) — so
 * a real 2hire webhook/command could address this vehicle by this id. The
 * Lås/Lås op buttons themselves still only write the virtual
 * vehicle_signals.locked flag today (see set-vehicle-lock.mts) — real 2hire
 * lock/unlock commands are still deferred, same as everywhere else in this
 * codebase.
 */
const TEST_VEHICLE_ID = "6ae6ac0e-b918-4843-b3c4-eae02560c06b";

/** Fallback map center used when the test vehicle has no GPS fix. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * 2hire test page ("/2hire-test", admin-only): a trimmed-down copy of
 * BookingDetailsPage for poking at the 2hire integration (live fuel/mileage/
 * status/position, Lås/Lås op) against a single dedicated test vehicle
 * (TEST_VEHICLE_ID) instead of a real booking's real vehicle — so testing
 * here can't hamper the system as it stands. Unlike BookingDetailsPage,
 * there's no underlying booking at all: no Periode/Anvendelse/Bruger rows,
 * no "Rediger reservation"/"Slet reservation", no map visibility window (the
 * map is just always shown), and the lock buttons use the always-enabled
 * admin rules (see useVehicleLockState) since this route is admin-gated.
 */
export function TwoHireTestPage() {
  const vehicles = use2hireVehicle();
  const gpsPositions = use2hireGPS();
  const twoHireVehicle = vehicles.find((v) => v.vehicleId === TEST_VEHICLE_ID);
  const position = gpsPositions.find((p) => p.vehicleId === TEST_VEHICLE_ID);

  const {
    locked: vehicleLocked,
    lockEnabled,
    unlockEnabled,
    loading: lockStateLoading,
    setLock,
    error: lockError,
  } = useVehicleLockState(TEST_VEHICLE_ID, null, true);
  /** "Køretøjet er nu låst/låst op" confirmation shown for 3s right after a successful setLock — see the Lås/Lås op buttons below. */
  const { activeKey: lockConfirmationKey, trigger: triggerLockConfirmation } = useTimedFlag();

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex flex-1 flex-col gap-4">
              <h2 className="text-xl font-semibold text-brand-800">2hire test side</h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center justify-between text-sm font-medium text-brand-700">
                      Køretøj:
                      {vehicleLocked && (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4 text-brand-500"
                          role="img"
                          aria-label="Køretøjet er låst"
                        >
                          <title>Køretøjet er låst</title>
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      )}
                    </label>
                    <span className="text-sm text-brand-800">
                      {twoHireVehicle ? `${twoHireVehicle.plate}: ${twoHireVehicle.brand} ${twoHireVehicle.model}` : TEST_VEHICLE_ID}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Brændstofniveau:</label>
                    <span className="text-sm text-brand-800">
                      {twoHireVehicle?.autonomyPercentage ?? "—"}
                      {twoHireVehicle?.autonomyPercentageUpdatedAt ? (
                        <span title={twoHireVehicle.autonomyPercentageUpdatedAt}>
                          {` (${shortSignalTimestamp(twoHireVehicle.autonomyPercentageUpdatedAt)})`}
                        </span>
                      ) : (
                        ""
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Kilometerstand:</label>
                    <span className="text-sm text-brand-800">
                      {twoHireVehicle?.distanceCovered ?? "—"}
                      {twoHireVehicle?.distanceCoveredUpdatedAt ? (
                        <span title={twoHireVehicle.distanceCoveredUpdatedAt}>
                          {` (${shortSignalTimestamp(twoHireVehicle.distanceCoveredUpdatedAt)})`}
                        </span>
                      ) : (
                        ""
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Status:</label>
                    <span className="text-sm text-brand-800">
                      {twoHireVehicle ? (twoHireVehicle.online === "TRUE" ? "Online" : "Offline") : "—"}
                      {twoHireVehicle?.onlineUpdatedAt ? (
                        <span title={twoHireVehicle.onlineUpdatedAt}>
                          {` (opdateret ${shortSignalTimestamp(twoHireVehicle.onlineUpdatedAt)})`}
                        </span>
                      ) : (
                        ""
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative isolate min-h-[12rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                <LeafletMap
                  lat={position?.lat ?? DENMARK_CENTER.lat}
                  lng={position?.lng ?? DENMARK_CENTER.lng}
                  zoom={position ? 17 : 7}
                  showMarker={Boolean(position)}
                  markerTooltip={twoHireVehicle?.plate ?? TEST_VEHICLE_ID}
                  className="absolute inset-0"
                />
                {!position && (
                  <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center p-4">
                    <div className="rounded-lg border border-red-500 bg-gray-500/50 px-4 py-2 text-center text-sm font-medium text-brand-900 shadow-lg">
                      Der er ingen GPS position tilgængelig for dette køretøj
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="group relative">
                  <button
                    type="button"
                    onClick={() => void (async () => {
                      const success = await setLock(false);
                      if (success) triggerLockConfirmation("unlocked");
                    })()}
                    disabled={!unlockEnabled || lockStateLoading}
                    aria-label="Lås op"
                    className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-2 py-1.5 text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                    </svg>
                  </button>
                  <InlinePopup
                    visible={lockConfirmationKey === "unlocked"}
                    message="Køretøjet er nu låst op. God tur"
                  />
                </div>
                <div className="group relative">
                  <button
                    type="button"
                    onClick={() => void (async () => {
                      const success = await setLock(true);
                      if (success) triggerLockConfirmation("locked");
                    })()}
                    disabled={!lockEnabled || lockStateLoading}
                    aria-label="Lås"
                    className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-2 py-1.5 text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </button>
                  <InlinePopup visible={lockConfirmationKey === "locked"} message="Køretøjet er nu låst" />
                </div>
              </div>

              {lockError && <p className="text-sm text-red-600">{lockError}</p>}
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
