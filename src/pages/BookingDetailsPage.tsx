import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/Button";
import { FieldRow } from "../components/FieldRow";
import { FieldList } from "../components/FieldList";
import { PageLoading } from "../components/PageLoading";
import { PageShell } from "../components/PageShell";
import { PageSectionBody } from "../components/PageSectionBody";
import { VehicleMapCard } from "../components/VehicleMapCard";
import { VehicleLockControlsRow } from "../components/VehicleLockControlsRow";
import { BlockedBadge } from "../components/BlockedBadge";
import { PageSection } from "../components/PageSection";
import { isAnyAdmin } from "../lib/roles";
import { use2hireGPS, use2hireVehicle, useRefreshVehicles, useSetLiveTracking } from "../contexts/VehicleContext";
import {
  BOOKING_ID_COLUMN,
  BOOKINGS_SELECT_COLUMNS,
  formatBookingPeriod,
  formatKilometerstand,
  formatVehicleIdentLabel,
  formatVehicleLabel,
  isMapVisible,
  mapBookingRow,
  nowIsoString,
  resolveVehicleGpsPosition,
  shortSignalTimestamp,
  userAnsatId,
  type BookingRow,
} from "../lib/bookings";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useBookingLifecycle, type LifecycleBooking } from "../hooks/useBookingLifecycle";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useMapViewSnapshot } from "../hooks/useMapViewSnapshot";
import { useReloadPersistedBoolean } from "../hooks/useReloadPersistedBoolean";
import { supabase } from "../lib/supabase";
import { useReverseGeocode } from "../lib/geocode";

/** A booking as passed in via router state from BookingsPage/AllBookingsPage, or fetched fresh by id below — a superset of useBookingLifecycle's own LifecycleBooking (the extra startDate/start/endDate/end fields are display strings this page's own formatBookingPeriod call below needs). */
type BookingDetails = LifecycleBooking & {
  startDate: string;
  start: string;
  endDate: string | null;
  end: string | null;
};

/** Fallback map center used when the booked vehicle has no GPS fix. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * Reservation detail view ("/booking-details/:bookingId"): the booking's
 * period/usage, the vehicle's current fuel/mileage/status (looked up live
 * from VehicleContext by vehicleId, not stored on the booking itself), a map
 * of its last known position — for a regular user, only shown from 15
 * minutes before the booking's start to 15 minutes after its end (see
 * isMapVisible; outside that window it's not rendered at all), but always
 * shown to admin/sysadm regardless of that window — a "Slet
 * reservation" cancel flow,
 * an "Afslut reservation" flow (enabled only within the booking's own
 * period — locks the vehicle and shortens the booking to end now, without
 * deleting it), and a "Rediger reservation" flow that re-enters
 * ReservationPage/AvailablePage/ConfirmPage pre-filled with this booking's
 * data, updating it on confirm instead of creating a new one. Normally
 * reached with the
 * booking pre-filled via router state (BookingsPage/AllBookingsPage), which
 * skips a round-trip; a direct URL/refresh/bookmark (no router state) falls
 * back to fetching it by the :bookingId route param instead, redirecting to
 * "/bookings" if it can't be found (deleted, or an invalid id).
 *
 * Shares its underlying booking actions (cancel/finish/edit/Blink/Horn/etc.)
 * with BookingPage.tsx (role "user"'s equivalent landing page) via
 * useBookingLifecycle — the two pages' layouts deliberately stay separate
 * (this one keeps the original table layout, plus admin-only Bruger/
 * Kilometerstand rows and a department lookup BookingPage has no need for),
 * only the handlers themselves are shared.
 */
export function BookingDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { bookingId } = useParams<{ bookingId: string }>();
  const { profile } = useAuth();
  const stateBooking = (location.state as { booking?: BookingDetails } | null)?.booking ?? null;
  const [fetchedBooking, setFetchedBooking] = useState<BookingDetails | null>(null);
  // Starts true whenever a fetch-by-id is actually needed (no stateBooking)
  // — starting false let a direct URL load's "not found yet, and not
  // loading" redirect-to-/bookings effect below fire on the very first
  // render, before the fetch effect's own setBookingLoading(true) had a
  // chance to apply (state updates from an earlier effect in the same
  // commit aren't visible to a later effect until the next render).
  const [bookingLoading, setBookingLoading] = useState(!stateBooking);
  const booking = stateBooking ?? fetchedBooking;
  /** Whether the BOOKING's OWN department (not the admin viewer's ambient/header-selected afdelingId — an admin/sysadm viewing another department's booking would otherwise get that department's Bruger-ID/permission settings applied to this one) shows the Bruger-ID value (vs. plain E-mail) in the "Bruger:" row below — see useIdentSettings' own doc comment. Same pattern as AllBookingsPage.tsx/DepartmentPage.tsx: the label is always "Bruger", only the value source swaps — who a booking belongs to is core information, not an optional extra. */
  const { useUserIdent, useVehicleIdent } = useIdentSettings(booking?.departmentId ?? null);

  const vehicles = use2hireVehicle();
  /** The freshest live data for this booking's vehicle — re-derived every render from VehicleContext's `vehicles` (patched instantly by the "trip_detected" broadcast, see VehicleContext.tsx), unlike `booking` above which is a router-state/fetch-by-id snapshot frozen at whatever moment it was loaded. Used below for the Live-toggle default and its auto-stop-when-parked effect. Null until `vehicles` contains this vehicle. */
  const liveVehicle = vehicles.find((v) => v.vehicleId === booking?.vehicle) ?? null;
  const gpsPositions = use2hireGPS();
  /** The vehicle's OWN, always-current position — feeds the marker (via markerLat/markerLng below), deliberately NOT the map's own center — see stableCenter below. */
  const position = booking ? resolveVehicleGpsPosition(booking.vehicle, gpsPositions) : null;
  /**
   * The map's own center — deliberately NOT re-derived on every live
   * position update (same pattern as FleetManagementPage.tsx's own
   * stableCenter/VehicleDetailsPage.tsx's identical fix). Without this,
   * passing `position.lat`/`position.lng` straight into LeafletMap's
   * `lat`/`lng` props would change them on every single live GPS tick (the
   * "Live" toggle's broadcast — see VehicleContext.tsx), which LeafletMap
   * treats as a genuine recenter request and rebuilds the WHOLE map for —
   * including resetting the zoom back to whatever the `zoom` prop below
   * says, discarding any zoom level the admin had manually set.
   * `Boolean(position)` (rather than a vehicleId, which
   * resolveVehicleGpsPosition's return shape doesn't carry) is the
   * recompute trigger instead: it flips false -> true exactly once, the
   * moment a first GPS fix actually arrives, then stays true (so this
   * doesn't recompute again) for every later position-only update of that
   * same fix.
   */
  const stableCenter = useMemo(
    () => (position ? { lat: position.lat, lng: position.lng } : DENMARK_CENTER),
    // position.lat/position.lng deliberately excluded — see this constant's
    // own doc comment just above.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [booking?.vehicle, Boolean(position)],
  );
  const isAdmin = isAnyAdmin(profile?.role);
  /** admin/sysadm always see the map, regardless of the booking's own start/end window — only a regular user's own map is time-gated (see isMapVisible below) to the 15-minutes-before-start through 15-minutes-after-end window. */
  const mapVisible = isAdmin || (booking ? isMapVisible(nowIsoString(), { start: booking.startIso, end: booking.endIso }) : false);
  /** Restores the map's pan/zoom across a browser refresh — see this hook's own doc comment for why that otherwise silently resets. Scoped to this booking's vehicle so refreshing on a different booking's page never shows a stale, unrelated vehicle's last-saved view. */
  const { savedView: savedMapView, onViewChange: handleMapViewChange } = useMapViewSnapshot(`booking-details-map:${booking?.vehicle ?? ""}`);
  /** Admin-only "Live" toggle on the map (see LeafletMap's liveToggle prop) — same push-based Realtime mechanism as FleetManagementPage.tsx's own Live toggle (see VehicleContext.tsx's useSetLiveTracking), just for this one vehicle: `position` above already re-derives live from gpsPositions on every render, so turning the shared broadcast listener on is all this page needs to do. Persisted across a genuine refresh via useReloadPersistedBoolean, same as FleetManagementPage's own liveEnabled — scoped to this booking's vehicle so refreshing on a different booking's page never inherits a stale on/off state. Defaults to ON when the vehicle is already mid-trip (2hire's live trip_detected signal, read from `liveVehicle` above rather than waiting on the `twoHireVehicle` destructured below since this hook call needs the value at mount, before that exists) — same reasoning as VehicleDetailsPage.tsx's identical default. Only evaluated once per mount (useState initializer), same caveat as there. */
  const [liveEnabled, setLiveEnabled] = useReloadPersistedBoolean(
    `booking-details-live:${booking?.vehicle ?? ""}`,
    liveVehicle?.tripDetected === "TRUE",
  );
  const setLiveTracking = useSetLiveTracking();
  const refreshVehicles = useRefreshVehicles();
  /** Forces a fresh fleet refetch every time this page is opened (or :bookingId changes without a remount) — VehicleContext's allVehicles/gpsPositions are otherwise only fetched once per login session by default (see useRefreshVehicles' own doc comment in VehicleContext.tsx), so twoHireVehicle's fields below (Kilometerstand/Drivmiddelniveau, and the Live-toggle default above) could otherwise stay stale for the rest of the session. Same fix as VehicleDetailsPage.tsx's identical mount effect. */
  useEffect(() => {
    void refreshVehicles();
  }, [bookingId, refreshVehicles]);
  useEffect(() => {
    setLiveTracking(liveEnabled);
    if (liveEnabled) void refreshVehicles();
    return () => setLiveTracking(false);
  }, [liveEnabled, setLiveTracking, refreshVehicles]);
  /** Auto-stops Live the instant this vehicle's trip actually ENDS (trip_detected TRUE -> FALSE) while Live is on — see VehicleDetailsPage.tsx's identical effect for the full reasoning (only fires on that specific transition, tracked via prevTripDetectedRef, so manually turning Live on for an already-parked vehicle doesn't immediately switch it back off). Driven by VehicleContext's "trip_detected" broadcast patching `liveVehicle` live, no polling. */
  const prevTripDetectedRef = useRef(liveVehicle?.tripDetected);
  useEffect(() => {
    const previous = prevTripDetectedRef.current;
    const current = liveVehicle?.tripDetected;
    if (liveEnabled && previous === "TRUE" && current === "FALSE") {
      setLiveEnabled(false);
    }
    prevTripDetectedRef.current = current;
  }, [liveVehicle?.tripDetected, liveEnabled, setLiveEnabled]);
  /** Reverse-geocoded address of the map position below, shown in the row underneath it — see lib/geocode.ts's useReverseGeocode. Not admin-gated, unlike VehicleDetailsPage's own use of this hook: the map itself is shown to a regular user for their own booking, so the address is too. Suppressed entirely while Live is on (`!liveEnabled`) — see VehicleDetailsPage.tsx's identical change for why: a driving vehicle's position changes on every broadcast tick, which was firing a fresh reverse-geocode request just as often. useReverseGeocode's own `enabled` semantics already do exactly what's wanted for free: address clears to null the instant Live turns on, and one fresh lookup fires automatically the instant Live turns back off (manually, or via the auto-stop-when-parked effect above) for wherever the vehicle actually ended up. */
  const { address, addressLoading } = useReverseGeocode(booking?.vehicle, position, mapVisible && !liveEnabled);

  const {
    twoHireVehicle,
    vehicleIdentInfo,
    userMayDeleteBooking,
    userMayEditBooking,
    isCancelling,
    showCancelConfirm,
    setShowCancelConfirm,
    isFinishing,
    showFinishConfirm,
    setShowFinishConfirm,
    error,
    vehicleLocked,
    lockEnabled,
    unlockEnabled,
    lockStateLoading,
    setLock,
    lockError,
    lockConfirmationKey,
    triggerLockConfirmation,
    isLocating,
    locateError,
    canFinishBooking,
    goToVehicleDetails,
    goToEditBooking,
    handleCancelBooking,
    handleFinishBooking,
    handleLocate,
    handleHonk,
  } = useBookingLifecycle(booking, {
    // admin/sysadm always get both Lås/Lås op buttons enabled,
    // regardless of the booking's own window — unlike BookingPage.tsx
    // (role "user" only), which never sets this.
    isAdminLock: isAdmin,
    useUserIdent,
    userId: profile?.user_id,
    afdelingId: booking?.departmentId ?? null,
  });
  /** "Slet reservation" is always shown for role=admin; for role=user, only when Tillad_slet_reservation is true for this department. */
  const canShowDeleteButton = isAdmin || userMayDeleteBooking;
  /** "Rediger reservation" is always shown for role=admin; for role=user, only when Tillad_rediger_reservation is true for this department. */
  const canShowEditButton = isAdmin || userMayEditBooking;

  /** "Kunde/afdeling:" row's data — this booking's own department (booking.departmentId) plus its costumer's name, fetched fresh rather than trusted from router state (unlike ConfirmPage, which resolves it once at booking-creation time and passes it straight through — a booking viewed here may be old, or reached by direct fetch-by-id, with no such state at all). departments'/costumers' SELECT RLS is unrestricted for any authenticated user, same as PageHeader's own "Data Filter" list. */
  const [departmentInfo, setDepartmentInfo] = useState<{ name: string; costumerName: string | null } | null>(null);
  useEffect(() => {
    if (!booking?.departmentId) {
      setDepartmentInfo(null);
      return;
    }

    let cancelled = false;
    void supabase
      .from("departments")
      .select("name, costumers(name)")
      .eq("department_id", booking.departmentId)
      .maybeSingle<{ name: string; costumers: { name: string } | null }>()
      .then(({ data }) => {
        if (cancelled) return;
        setDepartmentInfo(data ? { name: data.name, costumerName: data.costumers?.name ?? null } : null);
      });

    return () => {
      cancelled = true;
    };
  }, [booking?.departmentId]);
  /** "Kunde/afdeling:" row's display text — "Kunde / Afdeling" (space-slash-space), same format as ConfirmPage's own read-only summary row and PageHeader's "Data Filter" dropdown. */
  const departmentLabel = departmentInfo
    ? departmentInfo.costumerName
      ? `${departmentInfo.costumerName} / ${departmentInfo.name}`
      : departmentInfo.name
    : "—";
  /** "Køretøj:" row's identifying text — "{ident} / {plate}: {brand} {model}" (see formatVehicleIdentLabel) when useVehicleIdent and vehicle_ident are both set, else just "{plate}: {brand} {model}". Falls back to formatVehicleLabel's own plate (which is itself ident-or-plate, ungated) while vehicle_profiles hasn't loaded yet, so the row doesn't flash blank. */
  const vehicleLabel =
    booking && vehicleIdentInfo && twoHireVehicle
      ? `${formatVehicleIdentLabel(vehicleIdentInfo.vehicleIdent, vehicleIdentInfo.numberPlate, useVehicleIdent)}: ${twoHireVehicle.brand} ${twoHireVehicle.model}`
      : booking
        ? formatVehicleLabel(booking.vehicle, vehicles)
        : "";

  /** Fetch-by-id fallback for a direct URL/refresh/bookmark (no router state) — skipped entirely when stateBooking is already present, since that's the common, cheaper path. */
  useEffect(() => {
    if (stateBooking || !bookingId) return;

    let cancelled = false;
    setBookingLoading(true);
    void supabase
      .from("bookings")
      .select(BOOKINGS_SELECT_COLUMNS)
      .eq(BOOKING_ID_COLUMN, bookingId)
      .maybeSingle<BookingRow>()
      .then(({ data }) => {
        if (cancelled) return;
        setFetchedBooking(data ? mapBookingRow(data) : null);
        setBookingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bookingId, stateBooking]);

  useEffect(() => {
    if (!booking && !bookingLoading) {
      navigate("/bookings", { replace: true });
    }
  }, [booking, bookingLoading, navigate]);

  if (!booking) {
    return bookingLoading ? (
      <PageLoading label="Indlæser reservation…" />
    ) : null;
  }

  return (
    <>
      <PageShell>
          <PageHeader />

          <PageSection>
            <PageSectionBody>
              <h2 className="shrink-0 text-xl font-semibold text-brand-800">Reservationsdetaljer</h2>

              <FieldList>
                  <FieldRow label="Periode:">
                    <span className="text-sm text-brand-800">{formatBookingPeriod(booking, true)}</span>
                  </FieldRow>
                  <FieldRow label="Kunde/afdeling:">
                    <span className="text-sm text-brand-800">{departmentLabel}</span>
                  </FieldRow>
                  {isAdmin && (
                    <FieldRow label="Bruger:">
                      {booking.userId ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/user-details/${booking.userId}`)}
                          className="text-left text-sm text-accent-600 hover:underline"
                        >
                          {(useUserIdent ? userAnsatId(booking) : booking.userEmail) ?? "—"}
                        </button>
                      ) : (
                        <span className="text-sm text-brand-800">{(useUserIdent ? userAnsatId(booking) : booking.userEmail) ?? "—"}</span>
                      )}
                    </FieldRow>
                  )}
                  <FieldRow label="Anvendelse:">
                    <span className="text-sm text-brand-800">{booking.use}</span>
                  </FieldRow>
                  <FieldRow label="Køretøj:">
                    <span>
                      {twoHireVehicle ? (
                        <button
                          type="button"
                          onClick={goToVehicleDetails}
                          className="text-left text-sm text-accent-600 hover:underline"
                        >
                          {vehicleLabel}
                        </button>
                      ) : (
                        <span className="text-sm text-brand-800">{vehicleLabel}</span>
                      )}
                      {vehicleIdentInfo?.blocked && (
                        <BlockedBadge className="ml-2" />
                      )}
                    </span>
                  </FieldRow>
                  {/* Kilometerstand is only shown to admin/sysadm — a regular user's own reservation doesn't need this level of vehicle-condition detail. */}
                  {isAdmin && (
                    <FieldRow label="Kilometerstand:">
                      <span className="text-sm text-brand-800">
                        {twoHireVehicle?.distanceCovered ? formatKilometerstand(twoHireVehicle.distanceCovered) : "—"}
                        {twoHireVehicle?.distanceCoveredUpdatedAt
                          ? ` (${shortSignalTimestamp(twoHireVehicle.distanceCoveredUpdatedAt)})`
                          : ""}
                      </span>
                    </FieldRow>
                  )}
                  {/* Drivmiddelniveau (fuel/battery %) is appended onto this same row rather than shown as its own — the two are closely related enough not to need a separate label. */}
                  <FieldRow label="Drivmiddel:">
                    <span className="text-sm text-brand-800">
                      {vehicleIdentInfo?.drivmiddel ?? "—"}
                      {twoHireVehicle?.autonomyPercentage
                        ? ` ${twoHireVehicle.autonomyPercentage}${isAdmin && twoHireVehicle.autonomyPercentageUpdatedAt ? ` (${shortSignalTimestamp(twoHireVehicle.autonomyPercentageUpdatedAt)})` : ""}`
                        : ""}
                    </span>
                  </FieldRow>
              </FieldList>

              {mapVisible && (
                <VehicleMapCard
                  lat={savedMapView?.lat ?? stableCenter.lat}
                  lng={savedMapView?.lng ?? stableCenter.lng}
                  zoom={savedMapView?.zoom ?? (position ? 17 : 7)}
                  markerLat={position?.lat ?? DENMARK_CENTER.lat}
                  markerLng={position?.lng ?? DENMARK_CENTER.lng}
                  hasPosition={Boolean(position)}
                  onViewChange={handleMapViewChange}
                  markerTooltip={twoHireVehicle?.plate ?? booking.vehicle}
                  onMarkerClick={goToVehicleDetails}
                  liveToggle={isAdmin ? { active: liveEnabled, onToggle: () => setLiveEnabled((prev) => !prev) } : undefined}
                  addressLoading={addressLoading}
                  liveEnabled={liveEnabled}
                  address={address}
                />
              )}

              <VehicleLockControlsRow
                locked={vehicleLocked}
                lockEnabled={lockEnabled}
                unlockEnabled={unlockEnabled}
                lockLoading={lockStateLoading}
                onToggleLock={async (nextLocked) => {
                  const success = await setLock(nextLocked);
                  if (success) triggerLockConfirmation(nextLocked ? "locked" : "unlocked");
                  return success;
                }}
                lockConfirmationMessage={
                  lockConfirmationKey === "unlocked"
                    ? "Køretøjet er nu låst op. God tur"
                    : lockConfirmationKey === "locked"
                      ? "Køretøjet er nu låst"
                      : null
                }
                isLocating={isLocating}
                locateConfirmationVisible={lockConfirmationKey === "located"}
                onLocate={() => void handleLocate()}
                honkConfirmationVisible={lockConfirmationKey === "horn"}
                onHonk={handleHonk}
              />

              {/* Afslut/Rediger/Slet, all on one row (labels shortened from "... reservation" since the section they're in already makes that context clear). shrink-0 for the same reason as the Lås/Blink/Horn row above. */}
              <div className="flex shrink-0 gap-3">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setShowFinishConfirm(true)}
                  disabled={!canFinishBooking || isFinishing}
                  className="flex-1"
                >
                  Afslut
                </Button>
                {canShowEditButton && (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={goToEditBooking}
                    className="flex-1"
                  >
                    Rediger
                  </Button>
                )}
                {canShowDeleteButton && (
                  <Button
                    variant="danger"
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={isCancelling}
                    className="flex-1"
                  >
                    {isCancelling ? "Aflyser…" : "Slet"}
                  </Button>
                )}
              </div>

              {lockError && <p className="shrink-0 text-sm text-red-600">{lockError}</p>}
              {locateError && <p className="shrink-0 text-sm text-red-600">{locateError}</p>}

              {error && <p className="shrink-0 text-sm text-red-600">{error}</p>}
            </PageSectionBody>
          </PageSection>
      </PageShell>

      {showCancelConfirm && (
        <ConfirmDialog
          message="Er du sikker på, at du vil aflyse denne reservation?"
          onCancel={() => setShowCancelConfirm(false)}
          onConfirm={() => void handleCancelBooking()}
          isPending={isCancelling}
          confirmPendingLabel="Aflyser…"
        />
      )}

      {showFinishConfirm && (
        <ConfirmDialog
          message="Er du sikker på, at du vil afslutte denne reservation nu? Køretøjet låses, og reservationen sættes til at slutte nu. Du kan således ikke efterfølgende genoptage brugen af køretøjet uden at der foreligger en ny reservation."
          onCancel={() => setShowFinishConfirm(false)}
          onConfirm={() => void handleFinishBooking()}
          isPending={isFinishing}
          confirmPendingLabel="Afslutter…"
        />
      )}
    </>
  );
}
