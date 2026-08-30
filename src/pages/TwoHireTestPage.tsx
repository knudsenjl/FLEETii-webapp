import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { use2hireGPS, use2hireVehicle } from "../contexts/VehicleContext";
import { formatKilometerstand, shortSignalTimestamp } from "../lib/bookings";
import { PageHeader } from "../components/PageHeader";
import { HeadlightIcon } from "../components/HeadlightIcon";
import { HornIcon } from "../components/HornIcon";
import { InlinePopup } from "../components/InlinePopup";
import { LeafletMap } from "../components/LeafletMap";
import { LockStatusIcon } from "../components/LockStatusIcon";
import { VehicleLockToggle } from "../components/VehicleLockToggle";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { useLocateVehicle } from "../hooks/useLocateVehicle";
import { useMapViewSnapshot } from "../hooks/useMapViewSnapshot";

/**
 * Dedicated vehicle_profiles.vehicle_id for a copy of WB20418 (see
 * supabase/applied/seed_2hire_test_vehicle.sql), reused with NULL
 * costumer_id/department_id so it never shows up in any real customer's
 * fleet — this page always targets that one fixed vehicle, never a real
 * in-service one. This is also the real vehicleId 2hire's TEST adapter
 * assigned once WB20499 was actually registered as a simulated 2hire-board
 * device there (see supabase/applied/register_2hire_test_vehicle.sql) — so
 * a real 2hire webhook/command addresses this vehicle by this id.
 */
const TEST_VEHICLE_ID = "6ae6ac0e-b918-4843-b3c4-eae02560c06b";

/** This vehicle's e2e DEVICE identifier (vehicle_profiles.iot_id) — NOT TEST_VEHICLE_ID. getDeviceState keys on this, not the vehicleId — see twoHireClient.ts's own doc comment on why the two ids are different things. */
const TEST_DEVICE_IDENTIFIER = "741482310302896";

/** Fallback map center used when the test vehicle has no GPS fix. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * 2hire test page ("/2hire-test", admin-only): a trimmed-down copy of
 * BookingDetailsPage for poking at the 2hire integration (live fuel/mileage/
 * status/position, Lås/Lås op, "Blink") against a single dedicated
 * test vehicle (TEST_VEHICLE_ID) instead of a real booking's real vehicle —
 * so testing here can't hamper the system as it stands. Unlike
 * BookingDetailsPage, there's no underlying booking at all: no Periode/
 * Anvendelse/Bruger rows, no "Rediger reservation"/"Slet reservation", no map
 * visibility window (the map is just always shown). Unlike every other
 * Lås/Lås op button in this codebase, THIS page's buttons issue real 2hire
 * "start"/"stop" commands (2hire-vehicle-command.mts) and read back the real
 * resulting status (2hire-vehicle-state.mts) instead of just writing the
 * virtual vehicle_signals.locked flag (see set-vehicle-lock.mts) — that's
 * the whole point of this page existing.
 */
export function TwoHireTestPage() {
  const { session } = useAuth();
  const vehicles = use2hireVehicle();
  const gpsPositions = use2hireGPS();
  const twoHireVehicle = vehicles.find((v) => v.vehicleId === TEST_VEHICLE_ID);
  const position = gpsPositions.find((p) => p.vehicleId === TEST_VEHICLE_ID);
  /** Restores the map's pan/zoom across a browser refresh — see this hook's own doc comment for why that otherwise silently resets. Always the same fixed test vehicle, so no per-vehicle scoping is needed here (unlike BookingDetailsPage.tsx/VehicleDetailsPage.tsx's own use of this hook). */
  const { savedView: savedMapView, onViewChange: handleMapViewChange } = useMapViewSnapshot("2hire-test-map");

  const authHeaders: Record<string, string> = session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};

  /** The vehicle's REAL 2hire lock status (null while loading, or if the initial/refresh read fails) — see fetchLockState. */
  const [locked, setLocked] = useState<boolean | null>(null);
  const [lockStateLoading, setLockStateLoading] = useState(true);
  const [isLockActionPending, setIsLockActionPending] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  /** "Køretøjet er nu låst/låst op" confirmation shown for 3s right after a successful lock/unlock, and "Lygterne blinker" after a successful "Blink" — see the buttons below. */
  const { activeKey: lockConfirmationKey, trigger: triggerLockConfirmation } = useTimedFlag();
  const { isLocating, locateError, locate } = useLocateVehicle();

  /** Reads the vehicle's real 2hire status via 2hire-vehicle-state.mts and updates `locked`. Called on mount and again after every successful lock/unlock command, so `locked` always reflects what 2hire actually reports rather than what we asked it to do. */
  const fetchLockState = async () => {
    setLockStateLoading(true);
    try {
      const response = await fetch("/.netlify/functions/2hire-vehicle-state", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ identifier: TEST_DEVICE_IDENTIFIER }),
      });
      const result = (await response.json()) as { locked?: boolean; error?: string };
      if (!response.ok) {
        setLockError(result.error ?? "Kunne ikke hente lås-status.");
        setLocked(null);
        return;
      }
      setLocked(result.locked ?? null);
    } catch {
      setLockError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setLocked(null);
    } finally {
      setLockStateLoading(false);
    }
  };

  useEffect(() => {
    void fetchLockState();
    // Only on mount — session/authHeaders is stable in practice and
    // refetching on every render would be pointless; explicit refreshes
    // happen via handleSetLock after a command instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Lås/Lås op: sends 2hire's real generic "stop"/"start" command (see sendGenericCommand's doc comment — "stop" locks, "start" unlocks) via 2hire-vehicle-command.mts, then re-reads the real status rather than assuming the command did what it asked. */
  const handleSetLock = async (nextLocked: boolean) => {
    setIsLockActionPending(true);
    setLockError(null);

    try {
      const response = await fetch("/.netlify/functions/2hire-vehicle-command", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ vehicleId: TEST_VEHICLE_ID, command: nextLocked ? "stop" : "start" }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setLockError(result.error ?? "Kunne ikke opdatere lås-status.");
        setIsLockActionPending(false);
        return;
      }
    } catch {
      setLockError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsLockActionPending(false);
      return;
    }

    setIsLockActionPending(false);
    triggerLockConfirmation(nextLocked ? "locked" : "unlocked");
    await fetchLockState();
  };

  /** "Blink": sends 2hire's real generic "locate" command (blinks the headlights) via useLocateVehicle (2hire-vehicle-command.mts). */
  const handleLocate = async () => {
    const success = await locate(TEST_VEHICLE_ID);
    if (success) triggerLockConfirmation("located");
  };

  /** "Horn": intentionally a stub — 2hire's generic-command API doesn't have a confirmed horn/honk command yet (see 2hire-vehicle-command.mts), so this just surfaces "Endnu ikke implementeret" until the right command is found. Reuses the same lockConfirmationKey as Lås/Lås op/Blink rather than a second useTimedFlag instance, since only one of these popups is ever relevant at a time. */
  const handleHonk = () => {
    triggerLockConfirmation("horn");
  };

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">2hire test side</h2>

              {/* shrink-0: a flex item with overflow-hidden gets an automatic min-height of 0 (CSS spec behavior) — without this, vertical space pressure in the flex column can squeeze this whole box to zero height, silently clipping every row even though the DOM/data is correct. */}
              <div className="shrink-0 overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center justify-between text-sm font-medium text-brand-700">
                      Køretøj:
                      {locked !== null && <LockStatusIcon locked={locked} />}
                    </label>
                    <span className="text-sm text-brand-800">
                      {twoHireVehicle ? `${twoHireVehicle.plate}: ${twoHireVehicle.brand} ${twoHireVehicle.model}` : TEST_VEHICLE_ID}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Kilometerstand:</label>
                    <span className="text-sm text-brand-800">
                      {twoHireVehicle?.distanceCovered ? formatKilometerstand(twoHireVehicle.distanceCovered) : "—"}
                      {twoHireVehicle?.distanceCoveredUpdatedAt
                        ? ` (${shortSignalTimestamp(twoHireVehicle.distanceCoveredUpdatedAt)})`
                        : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Drivmiddelniveau:</label>
                    <span className="text-sm text-brand-800">
                      {twoHireVehicle?.autonomyPercentage ?? "—"}
                      {twoHireVehicle?.autonomyPercentageUpdatedAt
                        ? ` (${shortSignalTimestamp(twoHireVehicle.autonomyPercentageUpdatedAt)})`
                        : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center justify-between text-sm font-medium text-brand-700">
                      Status:
                      {/* Same green/red online-state dot as the "Online" column elsewhere (AllBookingsPage.tsx/VehiclesPage.tsx) — right-aligned within this label field, not the value field. Omitted entirely when twoHireVehicle hasn't loaded (matching the value's own "—" fallback). */}
                      {twoHireVehicle && (
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${twoHireVehicle.online === "TRUE" ? "bg-green-500" : "bg-red-500"}`}
                          title={twoHireVehicle.online === "TRUE" ? "Online" : "Offline"}
                        />
                      )}
                    </label>
                    <span className="text-sm text-brand-800">
                      {twoHireVehicle ? (twoHireVehicle.online === "TRUE" ? "Online" : "Offline") : "—"}
                      {twoHireVehicle?.onlineUpdatedAt
                        ? ` (${shortSignalTimestamp(twoHireVehicle.onlineUpdatedAt)})`
                        : ""}
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative isolate min-h-[12rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                <LeafletMap
                  lat={savedMapView?.lat ?? position?.lat ?? DENMARK_CENTER.lat}
                  lng={savedMapView?.lng ?? position?.lng ?? DENMARK_CENTER.lng}
                  zoom={savedMapView?.zoom ?? (position ? 17 : 7)}
                  markerLat={position?.lat ?? DENMARK_CENTER.lat}
                  markerLng={position?.lng ?? DENMARK_CENTER.lng}
                  onViewChange={handleMapViewChange}
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

              {/* No directional gating on this admin diagnostics page — both
                  directions are always allowed except while loading/pending,
                  unlike VehicleDetailsPage/BookingDetailsPage's
                  reservation-window gating. handleSetLock already triggers
                  its own confirmation, so onToggle just awaits it. */}
              <div className="flex gap-3">
                <VehicleLockToggle
                  className="flex-1"
                  locked={locked}
                  lockEnabled={true}
                  unlockEnabled={true}
                  loading={lockStateLoading || isLockActionPending}
                  onToggle={async (nextLocked) => {
                    await handleSetLock(nextLocked);
                    return true;
                  }}
                  confirmationMessage={
                    lockConfirmationKey === "unlocked"
                      ? "Køretøjet er nu låst op. God tur"
                      : lockConfirmationKey === "locked"
                        ? "Køretøjet er nu låst"
                        : null
                  }
                />
                <div className="group relative flex-1">
                  <button
                    type="button"
                    onClick={() => void handleLocate()}
                    disabled={isLocating}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <HeadlightIcon />
                    {isLocating ? "Blinker…" : "Blink"}
                  </button>
                  <InlinePopup visible={lockConfirmationKey === "located"} message="Lygterne blinker" />
                </div>
                <div className="group relative flex-1">
                  <button
                    type="button"
                    onClick={handleHonk}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                  >
                    <HornIcon />
                    Horn
                  </button>
                  <InlinePopup visible={lockConfirmationKey === "horn"} message="Endnu ikke implementeret" />
                </div>
              </div>

              {lockError && <p className="text-sm text-red-600">{lockError}</p>}
              {locateError && <p className="text-sm text-red-600">{locateError}</p>}
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
