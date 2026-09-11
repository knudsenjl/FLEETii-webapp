import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isAnyAdmin, isSysadm as isSysadmRole } from "../lib/roles";
import { use2hireGPS, use2hireVehicle, useRefreshVehicles, useSetLiveTracking, useVehiclesLoading } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { CarGlyph } from "../components/CarGlyph";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HeadlightIcon } from "../components/HeadlightIcon";
import { HornIcon } from "../components/HornIcon";
import { InlinePopup } from "../components/InlinePopup";
import { LeafletMap } from "../components/LeafletMap";
import { VehicleHealthIndicator } from "../components/VehicleHealthIndicator";
import { VehicleLockToggle } from "../components/VehicleLockToggle";
import { EyeGlyph } from "../components/EyeGlyph";
import { useVehicleLockState, type VehicleLockBookingContext } from "../hooks/useVehicleLockState";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useMapViewSnapshot } from "../hooks/useMapViewSnapshot";
import { useReloadPersistedBoolean } from "../hooks/useReloadPersistedBoolean";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { useLocateVehicle } from "../hooks/useLocateVehicle";
import { formatKilometerstand, formatVehicleIdentLabel, shortSignalTimestamp, toDisplayVehicle } from "../lib/bookings";
import { useReverseGeocode } from "../lib/geocode";
import { supabase } from "../lib/supabase";
import { formatIsoShort, getVehicleHealthIssues } from "../lib/vehicleHealth";

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
  autonomyPercentageUpdatedAtIso?: string | null;
  distanceCovered?: string;
  distanceCoveredUpdatedAt?: string;
  distanceCoveredUpdatedAtIso?: string | null;
  onlineUpdatedAt?: string;
  onlineUpdatedAtIso?: string | null;
  /** 2hire's live "trip_detected" signal ("TRUE"/"FALSE") — drives the driving-vehicle icon in the "Køretøj:" row below, same convention as BookingPage.tsx's hero-card car icon (see liveVehicleDataSource.ts's tripDetected mapping). */
  tripDetected?: string;
  tripDetectedUpdatedAtIso?: string | null;
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
  /** The 2hire-board device's own identifier (its QR code, as scanned at registration — see 2hire-register-vehicle.mts) — shown in the "QR-kode:" row below, sysadm only. */
  iot_id: string | null;
  /** The human-readable label of the 2hire vehicle-configuration profile picked at registration (see vehicle_profiles_add_twohire_profile.sql) — shown in the "2hire-profil:" row below, sysadm only. */
  twohire_profile: string | null;
};

/** Fallback map center (Denmark) used when a vehicle has no GPS fix. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * Vehicle detail view ("/vehicle-details/:vehicleId"): plate, model, fuel
 * level, mileage, a read-only Afdeling(er) row (the departments this
 * vehicle belongs to, via vehicle_departments), an admin/sysadm-only
 * driving-vehicle icon + red "!" health button next to the
 * "Køretøjsdetaljer" heading (see lib/vehicleHealth.ts — same feature as
 * VehiclesPage.tsx's fleet table, replacing the old standalone Status row
 * removed 2026-09-11), and (admin-only) a map
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
  // "admin OR sysadm" — same superset convention as ProtectedRoute's
  // own requireAdmin (App.tsx) and the server-side requireAdmin() helper;
  // this page has no requireAdmin route gate of its own (see doc comment
  // above), so it has to make this check itself.
  const isAdmin = isAnyAdmin(profile?.role);
  /** Stricter than isAdmin — gates the "QR-kode:"/"2hire-profil:" rows below, which a regular admin has no reason to see (2hire-board device internals, not fleet-management info). */
  const isSysadm = isSysadmRole(profile?.role);
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
  /**
   * The freshest data VehicleContext currently has for this vehicle — unlike
   * `vehicle` above, which is either a router-state snapshot frozen at
   * whatever moment the admin clicked in from (VehiclesPage/
   * FleetManagementPage/BookingDetailsPage all pass `{ state: { vehicle } }`)
   * or, in the no-router-state fallback, a one-time fetch-by-id snapshot
   * (see the effect below) that's never re-synced afterward either.
   * allVehicles/use2hireVehicle() itself is ALSO only fetched once per
   * session by default (see useRefreshVehicles' own doc comment in
   * VehicleContext.tsx) — but the mount effect below now forces a fresh
   * refetch every time this page is opened, so `liveVehicle` becomes
   * genuinely current shortly after mount and stays reactive to it (unlike
   * `vehicle`, which would keep showing 2hire's trip_detected/online/etc.
   * signal values from however long ago the admin actually navigated here,
   * even after that refetch resolves). Used below for exactly the
   * time-sensitive bits: the driving-icon/health-check and the Live-toggle
   * default. Null until allVehicles contains this vehicle.
   */
  const liveVehicle = allVehicles.find((v) => v.vehicleId === vehicle?.vehicleId) ?? null;
  const gpsPositions = use2hireGPS();
  const position = gpsPositions.find((g) => g.vehicleId === vehicle?.vehicleId);
  /** Restores the map's pan/zoom across a browser refresh — see this hook's own doc comment for why that otherwise silently resets. Scoped to this vehicle so refreshing on a different vehicle's page never shows a stale, unrelated vehicle's last-saved view. */
  const { savedView: savedMapView, onViewChange: handleMapViewChange } = useMapViewSnapshot(`vehicle-details-map:${vehicle?.vehicleId ?? ""}`);
  /** Admin-only "Live" toggle on the map (see LeafletMap's liveToggle prop) — same push-based Realtime mechanism as FleetManagementPage.tsx's own Live toggle (see VehicleContext.tsx's useSetLiveTracking), just for this one vehicle: `position` above already re-derives live from gpsPositions on every render, so turning the shared broadcast listener on is all this page needs to do. Persisted across a genuine refresh via useReloadPersistedBoolean, same as FleetManagementPage's own liveEnabled — scoped to this vehicle so refreshing on a different vehicle's page never inherits a stale on/off state. Defaults to ON when the vehicle is already mid-trip (2hire's live trip_detected signal, same one driving the header's CarGlyph icon above) — a driving vehicle's position is the one you'd actually want to watch move, so this saves the admin an extra click on the common "just clicked in from a moving vehicle" path; a parked vehicle still defaults off, same as before. Reads `liveVehicle` first (falling back to the possibly-stale `vehicle` only if allVehicles hasn't loaded this vehicle yet) so the default reflects the freshest data available AT MOUNT — still only evaluated once per mount (useState initializer), so it won't retroactively flip on once the mount effect's refetch below resolves; the toggle stays user-controlled from then on, same as the pre-existing reload-persistence behavior. */
  const [liveEnabled, setLiveEnabled] = useReloadPersistedBoolean(
    `vehicle-details-live:${vehicle?.vehicleId ?? ""}`,
    (liveVehicle?.tripDetected ?? vehicle?.tripDetected) === "TRUE",
  );
  const setLiveTracking = useSetLiveTracking();
  const refreshVehicles = useRefreshVehicles();
  /** Forces a fresh fleet refetch every time this page is opened (or the :vehicleId changes without a remount) — see `liveVehicle`'s own doc comment above for why this is needed at all: otherwise this vehicle's trip_detected/online/etc. signals could be showing whatever they were at login (or the last refreshVehicles() call anywhere in the app), arbitrarily stale. */
  useEffect(() => {
    void refreshVehicles();
  }, [vehicleId, refreshVehicles]);
  useEffect(() => {
    setLiveTracking(liveEnabled);
    if (liveEnabled) void refreshVehicles();
    return () => setLiveTracking(false);
  }, [liveEnabled, setLiveTracking, refreshVehicles]);

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
  /** vehicle_profiles.parking — fetched alongside numberPlate below, shown in the admin-only "P-plads:" row, last of the three (after "Afdeling(er):"/"Hjemmeafdeling:"). */
  const [parking, setParking] = useState<string | null>(null);
  /** vehicle_profiles.blocked_at — fetched alongside numberPlate below, non-null once "Bloker køretøj" has been used (see handleBlockVehicle). Drives the "Blokeret" badge next to the "Køretøj:" row. */
  const [blockedAt, setBlockedAt] = useState<string | null>(null);
  /** vehicle_profiles.iot_id — fetched alongside numberPlate below, shown in the sysadm-only "QR-kode:" row. */
  const [iotId, setIotId] = useState<string | null>(null);
  /** vehicle_profiles.twohire_profile — fetched alongside numberPlate below, shown in the sysadm-only "2hire-profil:" row. */
  const [twohireProfile, setTwohireProfile] = useState<string | null>(null);
  /** Whether the "QR-kode:"/"2hire-profil:" rows are expanded — toggled via the eye button on the "2hire-device:" row above them; start collapsed since both are raw device internals nobody needs on every visit. */
  const [showTwoHireDetails, setShowTwoHireDetails] = useState(false);
  /** Reverse-geocoded address for the vehicle's current GPS position, shown in the full-width row below the map — see lib/geocode.ts's useReverseGeocode. */
  const { address, addressLoading } = useReverseGeocode(vehicle?.vehicleId, position, isAdmin);
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

  /** Admin/sysadm-only red "!" health button shown next to the "Køretøjsdetaljer" heading below — see lib/vehicleHealth.ts's own doc comment (shared with VehiclesPage.tsx's fleet table) for what counts as "unhealthy". Reads `liveVehicle` (falling back to the possibly-stale `vehicle` only if allVehicles hasn't loaded this vehicle yet) — see liveVehicle's own doc comment for why: this button exists specifically to catch stale signals, so feeding it a frozen router-state snapshot would silently defeat its whole purpose. Empty (button hidden) for a non-admin viewer, same as VehiclesPage's own gating. */
  const healthIssues = isAdmin ? getVehicleHealthIssues(liveVehicle ?? vehicle, position?.updatedAtIso ?? null) : [];
  /** Whether the driving-vehicle icon shows next to the "Køretøjsdetaljer" heading below — admin/sysadm only, and only while 2hire's live trip_detected signal is currently true for this vehicle. Reads `liveVehicle` first, same reasoning as healthIssues above. */
  const isDriving = isAdmin && (liveVehicle?.tripDetected ?? vehicle.tripDetected) === "TRUE";

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
      setBlockError("Kunne ikke låse køretøjet via IoT device. Prøv igen.");
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
              <div className="flex shrink-0 items-center justify-between">
                <h2 className="text-xl font-semibold text-brand-800">Køretøjsdetaljer</h2>
                {/* Driving-vehicle icon (only while 2hire's trip_detected is currently true) + red "!" health button — both admin/sysadm-only, right-aligned next to this heading. Replaces the old standalone Status row (removed 2026-09-11) as the header-level admin health summary for this vehicle — see lib/vehicleHealth.ts, shared with VehiclesPage.tsx's fleet table. */}
                {isAdmin && (
                  <span className="flex items-center gap-1.5">
                    {isDriving && <CarGlyph className="h-4 w-6 text-green-600" title="Kører" />}
                    <VehicleHealthIndicator issues={healthIssues} formatLastReceived={formatIsoShort} />
                  </span>
                )}
              </div>

              {/* shrink-0: a flex item with overflow-hidden gets an automatic min-height of 0 (CSS spec behavior) — without this, vertical space pressure in the flex column can squeeze this whole box to zero height, silently clipping every row even though the DOM/data is correct. */}
              <div className="shrink-0 overflow-hidden rounded-2xl border border-brand-100">
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
                    <label className="flex items-center text-sm font-medium text-brand-700">Køretøj:</label>
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
                  {/* Kilometerstand is only shown to admin/sysadm — same gating as BookingDetailsPage.tsx's identical row. */}
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
                    <>
                      {/* Only shown once loaded, and only when this vehicle genuinely belongs to more than one department (or the fetch errored, so that error still surfaces) — a single department is already covered by "Hjemmeafdeling:" below, so listing it again here would just be redundant. */}
                      {!departmentsLoading && (departmentsError || vehicleDepartments.length > 1) && (
                        <div className="grid grid-cols-2 items-start gap-2 p-0.5">
                          <label className="flex items-center text-sm font-medium text-brand-700">Afdeling(er):</label>
                          <div className="text-sm text-brand-800">
                            {departmentsError ? (
                              <span className="text-red-600">{departmentsError}</span>
                            ) : (
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
                      )}
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
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">P-plads:</label>
                        <span className="text-sm text-brand-800">
                          {numberPlateLoading ? <span className="text-brand-500">Indlæser…</span> : (parking ?? "—")}
                        </span>
                      </div>
                    </>
                  )}
                  {/* sysadm-only — 2hire-board device internals, not fleet-management info a regular admin has any reason to see. See vehicle_profiles_add_twohire_profile.sql / 2hire-register-vehicle.mts for where these two are set. "2hire-device:" summarizes both as one Konfigureret/Ikke konfigureret badge, with the raw QR-kode/2hire-profil rows collapsed behind the eye button so they aren't shown by default. */}
                  {isSysadm && (
                    <>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">2hire-device:</label>
                        <span className="flex items-center justify-between text-sm text-brand-800">
                          {numberPlateLoading ? (
                            <span className="text-brand-500">Indlæser…</span>
                          ) : (
                            <span className={`font-medium ${iotId && twohireProfile ? "text-green-600" : "text-red-600"}`}>
                              {iotId && twohireProfile ? "Konfigureret" : "Ikke konfigureret"}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowTwoHireDetails((shown) => !shown)}
                            aria-label={showTwoHireDetails ? "Skjul QR-kode og 2hire-profil" : "Vis QR-kode og 2hire-profil"}
                            className="flex h-6 w-6 items-center justify-center rounded text-brand-500 transition hover:text-brand-700"
                          >
                            <EyeGlyph className="h-4 w-4" />
                          </button>
                        </span>
                      </div>
                      {showTwoHireDetails && (
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
                    </>
                  )}
                </div>
              </div>

              {isAdmin && (
                // Deliberately no min-h-0 here (unlike the scrolling ancestor
                // above, which needs it): this wrapper's own automatic
                // minimum height must stay content-based, so it can never be
                // flex-shrunk below what its map child's explicit
                // min-h-[12rem] requires. With min-h-0, overflow-y-auto on
                // the ancestor let this wrapper collapse toward 0 while the
                // map (overflow-hidden, so bounded to its own box) still
                // rendered its full 192px — but since a shrunk PARENT box
                // doesn't clip a child sized by its own min-height, the map
                // visually spilled downward past where the flex layout
                // thought this wrapper ended, painting over the Lås/Blink/
                // Horn button row directly below it. Keeping this wrapper's
                // height honest fixes that without needing overflow-hidden
                // here (which would just clip the map's bottom edge instead).
                <div className="flex flex-1 flex-col gap-1">
                  <div className="relative isolate min-h-[12rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                    <LeafletMap
                      lat={savedMapView?.lat ?? position?.lat ?? DENMARK_CENTER.lat}
                      lng={savedMapView?.lng ?? position?.lng ?? DENMARK_CENTER.lng}
                      zoom={savedMapView?.zoom ?? (position ? 17 : 7)}
                      markerLat={position?.lat ?? DENMARK_CENTER.lat}
                      markerLng={position?.lng ?? DENMARK_CENTER.lng}
                      onViewChange={handleMapViewChange}
                      showMarker={Boolean(position)}
                      markerTooltip={vehicle.plate}
                      className="absolute inset-0"
                      liveToggle={isAdmin ? { active: liveEnabled, onToggle: () => setLiveEnabled((prev) => !prev) } : undefined}
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
                    <div className="w-full shrink-0 rounded-2xl border border-brand-100 bg-white px-3 py-1.5 text-center text-xs text-brand-600">
                      {addressLoading ? "Henter adresse…" : (address ?? "Ingen adresse fundet")}
                    </div>
                  )}
                </div>
              )}

              {/* shrink-0: without this, overflow-y-auto on the scrolling ancestor above lets this row's automatic minimum size collapse below its own content height under vertical space pressure (a short window) — the row's box shrinks toward zero while its buttons keep their natural size, so the buttons render overlapping the map above instead of pushing it up and being scrolled to. Same fix applied to the Rediger/Bloker/Slet row below, which showed the same collapse (hidden entirely under the map). */}
              <div className="flex shrink-0 gap-3">
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

              {lockError && <p className="shrink-0 text-sm text-red-600">{lockError}</p>}
              {locateError && <p className="shrink-0 text-sm text-red-600">{locateError}</p>}

              {isAdmin && (
                <div className="grid shrink-0 grid-cols-3 gap-3">
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
