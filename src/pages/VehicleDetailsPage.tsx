import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireGPS, use2hireVehicle, useVehiclesLoading } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HeadlightIcon } from "../components/HeadlightIcon";
import { HornIcon } from "../components/HornIcon";
import { InlinePopup } from "../components/InlinePopup";
import { LeafletMap } from "../components/LeafletMap";
import { LockStatusIcon } from "../components/LockStatusIcon";
import { VehicleLockToggle } from "../components/VehicleLockToggle";
import { useVehicleLockState, type VehicleLockBookingContext } from "../hooks/useVehicleLockState";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { useLocateVehicle } from "../hooks/useLocateVehicle";
import { formatKilometerstand, formatVehicleIdentLabel, shortSignalTimestamp, toDisplayVehicle } from "../lib/bookings";
import { useReverseGeocode } from "../lib/geocode";
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

/** Raw shape of the vehicle_profiles row fetched here for the genuine Nummerplade/vehicle_ident PLUS this vehicle's own department_id (for the useIdentSettings gate below) — see the numberPlate fetch effect below for why the plate part can't just reuse vehicle.plate. Piggybacks department_id, drivmiddel, and parking onto this same query rather than extra round-trips, since none of these are admin-gated at the FETCH level (unlike the vehicleDepartments/homeDepartmentName effect above, which skips entirely for a non-admin viewer) — parking is still only ever shown inside the admin-only block below, just fetched here for simplicity. */
type VehicleProfilePlateRow = {
  number_plate: string | null;
  vehicle_ident: string | null;
  department_id: string | null;
  drivmiddel: string | null;
  parking: string | null;
  blocked_at: string | null;
  /** The 2hire-board device's own identifier (its QR code, as scanned at registration — see 2hire-register-vehicle.mts) — shown in the "QR-kode:" row below, FLEETii-admin only. */
  iot_id: string | null;
  /** The human-readable label of the 2hire vehicle-configuration profile picked at registration (see vehicle_profiles_add_twohire_profile.sql) — shown in the "2hire-profil:" row below, FLEETii-admin only. */
  twohire_profile: string | null;
};

/** Fallback map center (Denmark) used when a vehicle has no GPS fix. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * Vehicle detail view ("/vehicle-details/:vehicleId"): plate, model, fuel
 * level, mileage, status, a read-only Afdeling(er) row (the departments this
 * vehicle belongs to, via vehicle_departments), and (admin-only) a map
 * showing its last known GPS position (or a
 * "no GPS available" overlay if none exists), plus (also admin-only)
 * "Rediger køretøj" (to HandleVehiclePage, where Afdeling(er) is actually
 * editable) and "Slet køretøj" (both moved here from VehiclesPage) — "Slet
 * køretøj" doesn't delete anything directly, it only sends FLEETii a
 * deletion request (see send-vehicle-deletion-request.mts/VehicleDeletePage.tsx),
 * mirroring "Opret køretøj"'s request-based flow in reverse. Normally
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
  const { profile, session } = useAuth();
  // "admin OR FLEETii admin" — same superset convention as ProtectedRoute's
  // own requireAdmin (App.tsx) and the server-side requireAdmin() helper;
  // this page has no requireAdmin route gate of its own (see doc comment
  // above), so it has to make this check itself.
  const isAdmin = profile?.role === "admin" || profile?.role === "FLEETii admin";
  /** Stricter than isAdmin — gates the "QR-kode:"/"2hire-profil:" rows below, which a regular admin has no reason to see (2hire-board device internals, not fleet-management info). */
  const isFleetiiAdmin = profile?.role === "FLEETii admin";
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
  /** Whether a deletion request has been sent this session — hides "Slet køretøj" in favor of a confirmation message, so a duplicate request isn't one click away. Not persisted (mirrors NewVehiclePage.tsx's own `sent` state), since the vehicle itself is untouched until FLEETii fulfils the request. */
  const [deleteRequestSent, setDeleteRequestSent] = useState(false);

  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const [vehicleDepartments, setVehicleDepartments] = useState<VehicleDepartment[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  /** vehicle_profiles.department_id's own name (see supabase/applied/add_vehicle_profiles_costumer_and_department_fk.sql) — null if not yet set for this vehicle. Replaces the old vestigial DisplayVehicle.department field (toDisplayVehicle hardcodes that to "—" always). */
  const [homeDepartmentName, setHomeDepartmentName] = useState<string | null>(null);
  /** The genuine Nummerplade (vehicle_profiles.number_plate) — fetched separately since vehicle.plate (see the Vehicle type above) is Køretøj-ID-or-Nummerplade-fallback (see liveVehicleDataSource.ts's toVehicle2Hire), so once a vehicle has a vehicle_ident set, the actual plate is otherwise nowhere on this page at all. */
  const [numberPlate, setNumberPlate] = useState<string | null>(null);
  /** The genuine vehicle_ident (see the merged "Køretøj:" row below) — fetched alongside numberPlate rather than reusing vehicle.plate, for the same reason numberPlate itself is: the combined "{ident} - {plate}" display needs both raw values, not the already-collapsed ident-or-plate fallback. */
  const [vehicleIdent, setVehicleIdent] = useState<string | null>(null);
  const [numberPlateLoading, setNumberPlateLoading] = useState(true);
  /** This vehicle's own home department_id — fetched alongside numberPlate below (see VehicleProfilePlateRow), independent of the admin-only vehicleDepartments/homeDepartmentName effect above so a non-admin viewer still resolves this for the useIdentSettings gate. */
  const [identDepartmentId, setIdentDepartmentId] = useState<string | null>(null);
  /** vehicle_profiles.drivmiddel — fetched alongside numberPlate below, shown in the "Drivmiddel:" row. */
  const [drivmiddel, setDrivmiddel] = useState<string | null>(null);
  /** vehicle_profiles.parking — fetched alongside numberPlate below, shown in the admin-only "P-plads:" row right before "Hjemmeafdeling:". */
  const [parking, setParking] = useState<string | null>(null);
  /** vehicle_profiles.blocked_at — fetched alongside numberPlate below, non-null once "Bloker køretøj" has been used (see handleBlockVehicle). Drives the "Blokeret" badge next to the "Køretøj:" row. */
  const [blockedAt, setBlockedAt] = useState<string | null>(null);
  /** vehicle_profiles.iot_id — fetched alongside numberPlate below, shown in the FLEETii-admin-only "QR-kode:" row. */
  const [iotId, setIotId] = useState<string | null>(null);
  /** vehicle_profiles.twohire_profile — fetched alongside numberPlate below, shown in the FLEETii-admin-only "2hire-profil:" row. */
  const [twohireProfile, setTwohireProfile] = useState<string | null>(null);
  /** Reverse-geocoded address for the vehicle's current GPS position, shown in the full-width row below the map — see lib/geocode.ts's useReverseGeocode. */
  const { address, addressLoading } = useReverseGeocode(position, isAdmin);
  /** Whether this vehicle's own home department shows vehicle_ident at all in the merged "Køretøj:" row below — see useIdentSettings' own doc comment. */
  const { useVehicleIdent } = useIdentSettings(identDepartmentId);

  const bookingContext: VehicleLockBookingContext | null = booking
    ? { bookingId: booking.id, startIso: booking.startIso, endIso: booking.endIso }
    : null;
  const {
    locked: vehicleLocked,
    lockEnabled,
    unlockEnabled,
    loading: lockStateLoading,
    setLock,
    error: lockError,
  } = useVehicleLockState(vehicle?.vehicleId ?? "", bookingContext, isAdmin);
  /** "Køretøjet er nu låst/låst op"/"Lygterne blinker" confirmation shown for 3s right after a successful setLock/locate — see the Lås/Lås op and "Blink" buttons below. */
  const { activeKey: lockConfirmationKey, trigger: triggerLockConfirmation } = useTimedFlag();
  const { isLocating, locateError, locate } = useLocateVehicle();

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
        .sort((a, b) => a.name.localeCompare(b.name));
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

  /** Loads the genuine Nummerplade (see numberPlate's own doc comment above) — open to any authenticated user (not gated on isAdmin like the department fetch above), matching vehicle_profiles' own SELECT RLS. */
  useEffect(() => {
    if (!vehicle) return;

    let cancelled = false;
    setNumberPlateLoading(true);

    void supabase
      .from("vehicle_profiles")
      .select("number_plate, vehicle_ident, department_id, drivmiddel, parking, blocked_at, iot_id, twohire_profile")
      .eq("vehicle_id", vehicle.vehicleId)
      .maybeSingle<VehicleProfilePlateRow>()
      .then(({ data }) => {
        if (cancelled) return;
        setNumberPlate(data?.number_plate ?? null);
        setVehicleIdent(data?.vehicle_ident ?? null);
        setIdentDepartmentId(data?.department_id ?? null);
        setDrivmiddel(data?.drivmiddel ?? null);
        setParking(data?.parking ?? null);
        setBlockedAt(data?.blocked_at ?? null);
        setIotId(data?.iot_id ?? null);
        setTwohireProfile(data?.twohire_profile ?? null);
        setNumberPlateLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [vehicle]);

  if (!vehicle) {
    return vehiclesLoading ? (
      <div className="flex h-svh items-center justify-center bg-brand-50 text-brand-600">Indlæser køretøj…</div>
    ) : null;
  }

  /**
   * "Slet køretøj" doesn't delete anything directly — a customer admin can't,
   * since the physical 2hire board installed in the vehicle has to be
   * removed and the vehicle deregistered from 2hire, both FLEETii's job (see
   * send-vehicle-deletion-request.mts). This just records the request and
   * emails FLEETii; the real deletion happens later, from
   * VehicleDeletePage.tsx, once staff confirm the device is out. Stays on
   * this page on success (the vehicle still exists) and shows a persistent
   * confirmation instead — mirrors NewVehiclePage.tsx's "Bestillingen er
   * sendt." pattern.
   */
  const handleDeleteVehicle = async () => {
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch("/.netlify/functions/send-vehicle-deletion-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ vehicleId: vehicle.vehicleId }),
      });

      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok) {
        setDeleteError(result.error ?? "Kunne ikke sende anmodningen.");
        setIsDeleting(false);
        return;
      }
    } catch {
      setDeleteError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsDeleting(false);
      return;
    }

    setIsDeleting(false);
    setShowDeleteConfirm(false);
    setDeleteRequestSent(true);
  };

  /**
   * "Bloker køretøj": immobilizes the vehicle via 2hire's real "stop"
   * generic command (2hire has no distinct "immobilize" command — "stop" IS
   * the immobilize command, confirmed against 2hire's own API reference;
   * same command the regular "Lås" button sends) via the existing
   * useVehicleLockState.setLock, then additionally persists
   * vehicle_profiles.blocked_at so the vehicle is marked "Blokeret"
   * everywhere (VehiclesPage/AllBookingsPage/BookingDetailsPage/
   * FleetManagementPage), the same way costumers.deactivated_at marks a
   * blocked costumer — distinct from vehicle_signals.locked, which only
   * tracks the last Lås/Lås op press. Admin-only (see the button below);
   * setLock's own lockEnabled/unlockEnabled gate is already forced true for
   * isAdmin regardless of booking state, so this always succeeds
   * independent of whether the vehicle is currently reserved.
   */
  const handleBlockVehicle = async () => {
    setIsBlocking(true);
    setBlockError(null);

    const lockSuccess = await setLock(true);
    if (!lockSuccess) {
      setBlockError("Kunne ikke låse køretøjet via 2hire. Prøv igen.");
      setIsBlocking(false);
      return;
    }

    const blockedTimestamp = new Date().toISOString();
    const { error } = await supabase
      .from("vehicle_profiles")
      .update({ blocked_at: blockedTimestamp })
      .eq("vehicle_id", vehicle.vehicleId);

    if (error) {
      setBlockError("Køretøjet blev låst, men kunne ikke markeres som blokeret. Prøv igen.");
      setIsBlocking(false);
      return;
    }

    setBlockedAt(blockedTimestamp);
    setIsBlocking(false);
    setShowBlockConfirm(false);
  };

  /**
   * "Frigiv køretøj" (shown instead of "Bloker køretøj" once blockedAt is
   * set): sends 2hire's real "start" generic command — releasing the
   * 2hire-side immobilization "stop" put in place by handleBlockVehicle —
   * via setLock's new `command` override, but still persists
   * vehicle_signals.locked: true (NOT false/unlocked), since releasing an
   * administrative block should leave the vehicle in its normal resting
   * state (locked, waiting for the next renter's own booking to unlock it),
   * not in an actually-unlocked state with nobody renting it. Then clears
   * vehicle_profiles.blocked_at. Reuses the same isBlocking/blockError/
   * showBlockConfirm state as handleBlockVehicle — the two are mutually
   * exclusive (only one of "Bloker"/"Frigiv" is ever rendered at a time).
   */
  const handleUnblockVehicle = async () => {
    setIsBlocking(true);
    setBlockError(null);

    const releaseSuccess = await setLock(true, "start");
    if (!releaseSuccess) {
      setBlockError("Kunne ikke frigive køretøjet. Prøv igen.");
      setIsBlocking(false);
      return;
    }

    const { error } = await supabase
      .from("vehicle_profiles")
      .update({ blocked_at: null })
      .eq("vehicle_id", vehicle.vehicleId);

    if (error) {
      setBlockError("Køretøjet blev frigivet, men blokeringen kunne ikke fjernes. Prøv igen.");
      setIsBlocking(false);
      return;
    }

    setBlockedAt(null);
    setIsBlocking(false);
    setShowBlockConfirm(false);
  };

  /** "Blink": sends 2hire's real "locate" command via useLocateVehicle — same audience as Lås/Lås op (any user with a relevant booking, see 2hire-vehicle-command.mts's own doc comment on the auth split), not admin-only. */
  const handleLocate = async () => {
    const success = await locate(vehicle.vehicleId);
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
              <h2 className="text-xl font-semibold text-brand-800">Køretøjsdetaljer</h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    {/* Single merged row (was two: "Køretøj-ID:" + "Nummerplade:") —
                        "{vehicle_ident} - {number_plate}" when this vehicle's
                        department shows vehicle_ident AND it's actually set,
                        else just number_plate. This row always renders
                        regardless of useVehicleIdent (unlike the old,
                        separately-gated "Køretøj-ID:" row), so the "er låst"
                        indicator has one guaranteed-visible row to attach to
                        either way. */}
                    <label className="flex items-center justify-between text-sm font-medium text-brand-700">
                      Køretøj:
                      {vehicleLocked !== null && <LockStatusIcon locked={vehicleLocked} />}
                    </label>
                    <span className="text-sm text-brand-800">
                      {numberPlateLoading ? (
                        <span className="text-brand-500">Indlæser…</span>
                      ) : (
                        formatVehicleIdentLabel(vehicleIdent, numberPlate, useVehicleIdent)
                      )}
                      {/* Same "Blokeret" badge convention as CostumerAdministrationPage.tsx's blocked-costumer row — mirrors blockedAt (vehicle_profiles.blocked_at) everywhere this vehicle is shown. */}
                      {blockedAt && (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-red-700">
                          Blokeret
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Mærke:</label>
                    <span className="text-sm text-brand-800">
                      {vehicle.version ? `${vehicle.vehicle} - årgang: ${vehicle.version}` : vehicle.vehicle}
                    </span>
                  </div>
                  {/* Kilometerstand and Status are only shown to admin/FLEETii admin — same gating as BookingDetailsPage.tsx's identical rows. */}
                  {isAdmin && (
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">Kilometerstand:</label>
                      <span className="text-sm text-brand-800">
                        {vehicle.distanceCovered ? (
                          `${formatKilometerstand(vehicle.distanceCovered)}${vehicle.distanceCoveredUpdatedAt ? ` (${shortSignalTimestamp(vehicle.distanceCoveredUpdatedAt)})` : ""}`
                        ) : (
                          <span className="italic">Ingen information</span>
                        )}
                      </span>
                    </div>
                  )}
                  {/* Drivmiddelniveau (fuel/battery %) is appended onto this same row rather than shown as its own — the two are closely related enough not to need a separate label. */}
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Drivmiddel:</label>
                    <span className="text-sm text-brand-800">
                      {numberPlateLoading ? (
                        <span className="text-brand-500">Indlæser…</span>
                      ) : (
                        <>
                          {drivmiddel ?? "—"}
                          {vehicle.autonomyPercentage
                            ? ` ${vehicle.autonomyPercentage}${isAdmin && vehicle.autonomyPercentageUpdatedAt ? ` (${shortSignalTimestamp(vehicle.autonomyPercentageUpdatedAt)})` : ""}`
                            : ""}
                        </>
                      )}
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center justify-between text-sm font-medium text-brand-700">
                        Status:
                        {/* Same green/red online-state dot as the "Online" column elsewhere (AllBookingsPage.tsx/VehiclesPage.tsx) — right-aligned within this label field, not the value field. */}
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${vehicle.status === "Online" ? "bg-green-500" : "bg-red-500"}`}
                          title={vehicle.status}
                        />
                      </label>
                      <span className="text-sm text-brand-800">
                        {vehicle.status}
                        {vehicle.onlineUpdatedAt ? ` (${shortSignalTimestamp(vehicle.onlineUpdatedAt)})` : ""}
                      </span>
                    </div>
                  )}
                  {isAdmin && (
                    <>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">P-plads:</label>
                        <span className="text-sm text-brand-800">
                          {numberPlateLoading ? <span className="text-brand-500">Indlæser…</span> : (parking ?? "—")}
                        </span>
                      </div>
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
                  {/* FLEETii-admin-only — 2hire-board device internals, not fleet-management info a regular admin has any reason to see. See vehicle_profiles_add_twohire_profile.sql / 2hire-register-vehicle.mts for where these two are set. */}
                  {isFleetiiAdmin && (
                    <>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">QR-kode:</label>
                        <span className="text-sm text-brand-800">
                          {numberPlateLoading ? <span className="text-brand-500">Indlæser…</span> : (iotId ?? "—")}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">2hire-profil:</label>
                        <span className="text-sm text-brand-800">
                          {numberPlateLoading ? <span className="text-brand-500">Indlæser…</span> : (twohireProfile ?? "—")}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {isAdmin && (
                <div className="flex min-h-0 flex-1 flex-col gap-1">
                  <div className="relative isolate min-h-[12rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                    <LeafletMap
                      lat={position?.lat ?? DENMARK_CENTER.lat}
                      lng={position?.lng ?? DENMARK_CENTER.lng}
                      zoom={position ? 17 : 7}
                      showMarker={Boolean(position)}
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

                  {/* Reverse-geocoded address of the map position above (Nominatim) — full width, smaller text than the detail rows since it's supplementary context, not a primary field. Kept in the same flex-col as the map (gap-1) rather than a sibling of it, so it sits closer to the map than the parent's own gap-4 would otherwise allow. Only rendered with a real GPS fix. */}
                  {position && (
                    <div className="w-full rounded-2xl border border-brand-100 bg-white px-3 py-1.5 text-center text-xs text-brand-600">
                      {addressLoading ? "Henter adresse…" : (address ?? "Ingen adresse fundet")}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <VehicleLockToggle
                  className="flex-1"
                  locked={vehicleLocked}
                  lockEnabled={lockEnabled}
                  unlockEnabled={unlockEnabled}
                  loading={lockStateLoading}
                  onToggle={async (nextLocked) => {
                    const success = await setLock(nextLocked);
                    if (success) triggerLockConfirmation(nextLocked ? "locked" : "unlocked");
                    return success;
                  }}
                  cannotUnlockMessage="Du kan først låse op, når din reservation er startet"
                  cannotLockMessage="Du kan kun låse køretøjer, efter reservationen er startet, og indtil køretøjet er i brug af en anden"
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

              {isAdmin && (
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => navigate("/edit-vehicle", { state: { vehicle } })}
                    className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                  >
                    Rediger
                  </button>
                  {/* Toggles to "Frigiv" once blocked (handleUnblockVehicle) — same showBlockConfirm dialog, branched by blockedAt below. */}
                  {blockedAt ? (
                    <button
                      type="button"
                      onClick={() => setShowBlockConfirm(true)}
                      className="rounded-lg border-2 border-red-600 bg-white px-2 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                    >
                      Frigiv
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowBlockConfirm(true)}
                      className="rounded-lg border-2 border-red-600 bg-white px-2 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                    >
                      Bloker
                    </button>
                  )}
                  {deleteRequestSent ? (
                    <span className="flex items-center justify-center rounded-lg bg-accent-50 px-2 py-1.5 text-center text-sm font-semibold text-accent-700">
                      Anmodning om sletning er sendt
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="rounded-lg border-2 border-red-600 bg-white px-2 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                    >
                      Slet
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </motion.main>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          message="Er du sikker på, at du vil anmode om sletning af dette køretøj? FLEETii kontakter dig for at aftale afmontering af evt. installeret device."
          error={deleteError}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={() => void handleDeleteVehicle()}
          isPending={isDeleting}
          confirmPendingLabel="Sender…"
        />
      )}

      {showBlockConfirm && (
        <ConfirmDialog
          message={
            blockedAt
              ? "Er du sikker på, at du vil frigive dette køretøj? Køretøjet frigives med det samme i låst tilstand."
              : "Er du sikker på, at du vil blokere dette køretøj? Køretøjet låses med det samme og kan ikke startes igen før det frigives."
          }
          error={blockError}
          onCancel={() => setShowBlockConfirm(false)}
          onConfirm={() => void (blockedAt ? handleUnblockVehicle() : handleBlockVehicle())}
          isPending={isBlocking}
          confirmPendingLabel={blockedAt ? "Frigiver…" : "Blokerer…"}
        />
      )}
    </div>
  );
}
