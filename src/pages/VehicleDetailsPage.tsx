import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireGPS, use2hireVehicle, useVehiclesLoading } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LeafletMap } from "../components/LeafletMap";
import { useVehicleLockState, type VehicleLockBookingContext } from "../hooks/useVehicleLockState";
import { shortSignalTimestamp, toDisplayVehicle } from "../lib/bookings";
import { supabase } from "../lib/supabase";

/** The DisplayVehicle shape (see toDisplayVehicle in lib/bookings.ts), as received via router state from whichever page navigated here (VehiclesPage, FleetManagementPage, BookingDetailsPage). */
type Vehicle = {
  vehicleId: string;
  vehicle: string;
  plate: string;
  department: string;
  status: string;
  version?: string;
  autonomyPercentage?: string;
  autonomyPercentageUpdatedAt?: string;
  distanceCovered?: string;
  distanceCoveredUpdatedAt?: string;
  onlineUpdatedAt?: string;
};

/** The regular user's own reservation for this vehicle, if reached via BookingDetailsPage's map marker — see useVehicleLockState. Only ever present for a non-admin; admin navigation paths (VehiclesPage, FleetManagementPage) don't pass one. */
type RouterBooking = { id: string; startIso: string; endIso: string | null };

/** A department this vehicle belongs to, as shown in the read-only Afdeling(er) row below. */
type VehicleDepartment = { department_id: string; name: string };

/** Raw shape of a vehicle_departments row as selected here, with the department's name embedded via FK. */
type VehicleDepartmentRow = { department_id: string; departments: { name: string } | null };

/** Raw shape of the vehicle_profiles row fetched here for its home department — just the scalar department_id, resolved to a name via a separate departments lookup (see the fetch effect below for why this isn't a single embedded query). */
type VehicleProfileHomeRow = { department_id: string | null };

/** Fallback map center (Denmark) used when a vehicle has no GPS fix. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * Vehicle detail view ("/vehicle-details/:vehicleId"): plate, model, fuel
 * level, mileage, status, a read-only Afdeling(er) row (the departments this
 * vehicle belongs to, via vehicle_departments — "Alle køretøjer" always
 * first), and (admin-only) a map showing its last known GPS position (or a
 * "no GPS available" overlay if none exists), plus (also admin-only)
 * "Rediger køretøj" (to HandleVehiclePage, where Afdeling(er) is actually
 * editable) and "Slet køretøj" (both moved here from VehiclesPage). Normally
 * reached with the vehicle pre-filled via router state (VehiclesPage/
 * FleetManagementPage/BookingDetailsPage), which skips a round-trip; a
 * direct URL/refresh/bookmark (no router state) falls back to looking the
 * :vehicleId route param up in the already-loaded VehicleContext fleet list
 * (see useVehiclesLoading — no extra fetch needed, the whole fleet is loaded
 * on auth anyway), redirecting to the fleet table if it can't be found there
 * either. A regular user can land here too (e.g. via their own booking's map
 * marker on BookingDetailsPage), so the map and both actions are gated on
 * profile.role rather than the route itself.
 */
export function VehicleDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const state = location.state as { vehicle?: Vehicle; booking?: RouterBooking } | null;
  const stateVehicle = state?.vehicle ?? null;
  const booking = state?.booking ?? null;
  const allVehicles = use2hireVehicle();
  const vehiclesLoading = useVehiclesLoading();
  // Stored in state (rather than derived inline from allVehicles.find(...) +
  // toDisplayVehicle() on every render) so its reference stays stable once
  // set — toDisplayVehicle() builds a brand-new object every call, and an
  // inline derivation would hand a fresh `vehicle` reference to every effect
  // below on every single render, re-triggering the vehicleDepartments fetch
  // effect (which depends on [vehicle, isAdmin]) in an unnecessary loop.
  const [fetchedVehicle, setFetchedVehicle] = useState<Vehicle | null>(null);
  const vehicle = stateVehicle ?? fetchedVehicle;
  const gpsPositions = use2hireGPS();
  const position = gpsPositions.find((g) => g.vehicleId === vehicle?.vehicleId);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [vehicleDepartments, setVehicleDepartments] = useState<VehicleDepartment[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  /** vehicle_profiles.department_id's own name (see supabase/applied/add_vehicle_profiles_costumer_and_department_fk.sql) — null if not yet set for this vehicle. Replaces the old vestigial DisplayVehicle.department field (toDisplayVehicle hardcodes that to "—" always). */
  const [homeDepartmentName, setHomeDepartmentName] = useState<string | null>(null);

  const bookingContext: VehicleLockBookingContext | null = booking
    ? { bookingId: booking.id, startIso: booking.startIso, endIso: booking.endIso }
    : null;
  const {
    lockEnabled,
    unlockEnabled,
    loading: lockStateLoading,
    setLock,
    error: lockError,
  } = useVehicleLockState(vehicle?.vehicleId ?? "", bookingContext, isAdmin);

  /** Fetch-by-id fallback for a direct URL/refresh/bookmark (no router state) — looks the :vehicleId up in the already-loaded VehicleContext fleet list rather than issuing a new query (see useVehiclesLoading's doc comment for why vehiclesLoading matters here: allVehicles starts empty and this effect would otherwise resolve to "not found" before the context's own fetch has even finished). Skipped entirely when stateVehicle is already present. */
  useEffect(() => {
    if (stateVehicle || !vehicleId || vehiclesLoading) return;
    const twoHireVehicle = allVehicles.find((v) => v.vehicleId === vehicleId);
    setFetchedVehicle(twoHireVehicle ? toDisplayVehicle(twoHireVehicle) : null);
  }, [stateVehicle, vehicleId, vehiclesLoading, allVehicles]);

  useEffect(() => {
    if (!vehicle && !vehiclesLoading) {
      navigate("/fleet-table", { replace: true });
    }
  }, [vehicle, vehiclesLoading, navigate]);

  /**
   * Loads the departments this vehicle currently belongs to
   * (vehicle_departments, joined for the display name) and its own home
   * department (vehicle_profiles.department_id) — both read-only here,
   * unlike HandleVehiclePage's editable Afdeling(er)/Hjemmeafdeling. "Alle
   * køretøjer" always sorts first among vehicleDepartments (see
   * AuthContext.tsx's loadAvailableDepartments for the same convention).
   *
   * The home department's name is resolved via a second, separate query
   * (fetch department_id, then look its name up in departments) rather than
   * a single `vehicle_profiles.select("departments(name)")` embedded query
   * — that embed reliably came back null despite department_id genuinely
   * being set (confirmed via a direct diagnostic query), most likely
   * PostgREST's schema cache not having picked up this FK yet (it was added
   * via a later migration, see add_vehicle_profiles_costumer_and_department_fk.sql).
   * Splitting into two plain queries sidesteps that relationship-detection
   * entirely.
   */
  useEffect(() => {
    if (!vehicle || !isAdmin) return;

    let cancelled = false;
    setDepartmentsLoading(true);
    setDepartmentsError(null);

    void Promise.all([
      supabase
        .from("vehicle_departments")
        .select("department_id, departments(name)")
        .eq("vehicle_id", vehicle.vehicleId)
        .returns<VehicleDepartmentRow[]>(),
      supabase
        .from("vehicle_profiles")
        .select("department_id")
        .eq("vehicle_id", vehicle.vehicleId)
        .maybeSingle<VehicleProfileHomeRow>(),
    ]).then(async ([vehicleDepartmentsResult, homeResult]) => {
      if (cancelled) return;
      if (vehicleDepartmentsResult.error) {
        setDepartmentsError(vehicleDepartmentsResult.error.message);
        setDepartmentsLoading(false);
        return;
      }
      const departments = (vehicleDepartmentsResult.data ?? [])
        .filter((row): row is VehicleDepartmentRow & { departments: { name: string } } => row.departments !== null)
        .map((row) => ({ department_id: row.department_id, name: row.departments.name }))
        .sort((a, b) => {
          if (a.name === "Alle køretøjer") return -1;
          if (b.name === "Alle køretøjer") return 1;
          return a.name.localeCompare(b.name);
        });
      setVehicleDepartments(departments);

      const homeDepartmentId = homeResult.data?.department_id ?? null;
      if (!homeDepartmentId) {
        setHomeDepartmentName(null);
        setDepartmentsLoading(false);
        return;
      }
      const { data: homeDepartment } = await supabase
        .from("departments")
        .select("name")
        .eq("department_id", homeDepartmentId)
        .maybeSingle<{ name: string }>();
      if (cancelled) return;
      setHomeDepartmentName(homeDepartment?.name ?? null);
      setDepartmentsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [vehicle, isAdmin]);

  if (!vehicle) {
    return vehiclesLoading ? (
      <div className="flex h-dvh items-center justify-center bg-brand-50 text-brand-600">Indlæser køretøj…</div>
    ) : null;
  }

  /**
   * Deletes this vehicle's vehicle_signals row (if any) and then its
   * vehicle_profiles row — in that order, since vehicle_signals.vehicle_id
   * has a foreign key to vehicle_profiles.vehicle_id, and its on-delete
   * behavior isn't known here (see supabase/rename_vehicle_id_to_uuid.sql's
   * header), so the child row is removed explicitly rather than assumed to
   * cascade. Returns to the fleet table on success, since this page has
   * nothing left to show.
   */
  const handleDeleteVehicle = async () => {
    setIsDeleting(true);
    setDeleteError(null);

    const { error: signalsError } = await supabase
      .from("vehicle_signals")
      .delete()
      .eq("vehicle_id", vehicle.vehicleId);

    if (signalsError) {
      setDeleteError(signalsError.message);
      setIsDeleting(false);
      return;
    }

    const { error: profileError } = await supabase
      .from("vehicle_profiles")
      .delete()
      .eq("vehicle_id", vehicle.vehicleId);

    if (profileError) {
      setDeleteError(profileError.message);
      setIsDeleting(false);
      return;
    }

    setIsDeleting(false);
    navigate("/fleet-table", { replace: true });
  };

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
              <h2 className="text-xl font-semibold text-brand-800">Køretøjsdetaljer</h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Nummerplade:</label>
                    <span className="text-sm text-brand-800">{vehicle.plate}</span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Mærke:</label>
                    <span className="text-sm text-brand-800">
                      {vehicle.version ? `${vehicle.vehicle} - årgang: ${vehicle.version}` : vehicle.vehicle}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Brændstofniveau:</label>
                    <span
                      className="text-sm text-brand-800"
                      title={
                        vehicle.autonomyPercentage && vehicle.autonomyPercentageUpdatedAt
                          ? `${vehicle.autonomyPercentage} (${vehicle.autonomyPercentageUpdatedAt})`
                          : undefined
                      }
                    >
                      {vehicle.autonomyPercentage ? (
                        `${vehicle.autonomyPercentage}${vehicle.autonomyPercentageUpdatedAt ? ` (${shortSignalTimestamp(vehicle.autonomyPercentageUpdatedAt)})` : ""}`
                      ) : (
                        <span className="italic">Ingen information</span>
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Kilometerstand:</label>
                    <span
                      className="text-sm text-brand-800"
                      title={
                        vehicle.distanceCovered && vehicle.distanceCoveredUpdatedAt
                          ? `${vehicle.distanceCovered} (${vehicle.distanceCoveredUpdatedAt})`
                          : undefined
                      }
                    >
                      {vehicle.distanceCovered ? (
                        `${vehicle.distanceCovered}${vehicle.distanceCoveredUpdatedAt ? ` (${shortSignalTimestamp(vehicle.distanceCoveredUpdatedAt)})` : ""}`
                      ) : (
                        <span className="italic">Ingen information</span>
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Status:</label>
                    <span
                      className="text-sm text-brand-800"
                      title={vehicle.onlineUpdatedAt ? `${vehicle.status} (opdateret ${vehicle.onlineUpdatedAt})` : undefined}
                    >
                      {vehicle.status}
                      {vehicle.onlineUpdatedAt ? ` (opdateret ${shortSignalTimestamp(vehicle.onlineUpdatedAt)})` : ""}
                    </span>
                  </div>
                  {isAdmin && (
                    <>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">Hjemmeafdeling:</label>
                        <span className="text-sm text-brand-800">
                          {departmentsLoading ? (
                            <span className="text-brand-500">Indlæser…</span>
                          ) : (
                            (homeDepartmentName ?? "—")
                          )}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 items-start gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">Afdeling(er):</label>
                        <div className="text-sm text-brand-800">
                          {departmentsLoading && <span className="text-brand-500">Indlæser…</span>}
                          {!departmentsLoading && departmentsError && (
                            <span className="text-red-600">{departmentsError}</span>
                          )}
                          {!departmentsLoading && !departmentsError && vehicleDepartments.length === 0 && (
                            <span className="text-brand-500">—</span>
                          )}
                          {!departmentsLoading && !departmentsError && vehicleDepartments.length > 0 && (
                            <table className="w-full border-collapse">
                              <tbody>
                                {vehicleDepartments.map((department) => (
                                  <tr key={department.department_id}>
                                    <td className="py-0">{department.name}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {isAdmin && (
                <div className="relative isolate min-h-[12rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                  <LeafletMap
                    lat={position?.lat ?? DENMARK_CENTER.lat}
                    lng={position?.lng ?? DENMARK_CENTER.lng}
                    zoom={position ? 17 : 7}
                    showMarker={Boolean(position)}
                    markerClickable={false}
                    markerTooltip={vehicle.plate}
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
              )}

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => void setLock(true)}
                  disabled={!lockEnabled || lockStateLoading}
                  aria-label="Lås"
                  className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-2 py-1.5 text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => void setLock(false)}
                  disabled={!unlockEnabled || lockStateLoading}
                  aria-label="Lås op"
                  className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-2 py-1.5 text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                  </svg>
                </button>
              </div>

              {lockError && <p className="text-sm text-red-600">{lockError}</p>}

              {isAdmin && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => navigate("/edit-vehicle", { state: { vehicle } })}
                    className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Rediger køretøj
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Slet køretøj
                  </button>
                </div>
              )}
            </div>
          </section>
        </motion.main>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          message="Er du sikker på, at du vil slette dette køretøj?"
          error={deleteError}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={() => void handleDeleteVehicle()}
          isPending={isDeleting}
          confirmPendingLabel="Sletter…"
        />
      )}
    </div>
  );
}
