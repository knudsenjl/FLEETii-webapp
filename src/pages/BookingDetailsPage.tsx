import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
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
import { HeadlightIcon } from "../components/HeadlightIcon";
import { HornIcon } from "../components/HornIcon";
import { InlinePopup } from "../components/InlinePopup";
import { LeafletMap } from "../components/LeafletMap";
import { LockStatusIcon } from "../components/LockStatusIcon";
import { VehicleLockToggle } from "../components/VehicleLockToggle";
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
 * shown to admin/FLEETii admin regardless of that window — a "Slet
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
 * Kilometerstand/Status rows and a department lookup BookingPage has no
 * need for), only the handlers themselves are shared.
 */
export function BookingDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { bookingId } = useParams<{ bookingId: string }>();
  const { profile, afdelingId } = useAuth();
  /** Whether afdelingId's department shows the Bruger-ID value (vs. plain E-mail) in the "Bruger:" row below — see useIdentSettings' own doc comment. Same pattern as AllBookingsPage.tsx/DepartmentPage.tsx: the label is always "Bruger", only the value source swaps — who a booking belongs to is core information, not an optional extra. */
  const { useUserIdent, useVehicleIdent } = useIdentSettings(afdelingId);
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

  const vehicles = use2hireVehicle();
  const gpsPositions = use2hireGPS();
  const position = booking ? resolveVehicleGpsPosition(booking.vehicle, gpsPositions) : null;
  const isAdmin = isAnyAdmin(profile?.role);
  /** admin/FLEETii admin always see the map, regardless of the booking's own start/end window — only a regular user's own map is time-gated (see isMapVisible below) to the 15-minutes-before-start through 15-minutes-after-end window. */
  const mapVisible = isAdmin || (booking ? isMapVisible(nowIsoString(), { start: booking.startIso, end: booking.endIso }) : false);
  /** Reverse-geocoded address of the map position below, shown in the row underneath it — see lib/geocode.ts's useReverseGeocode. Not admin-gated, unlike VehicleDetailsPage's own use of this hook: the map itself is shown to a regular user for their own booking, so the address is too. */
  const { address, addressLoading } = useReverseGeocode(position, mapVisible);
  /** Restores the map's pan/zoom across a browser refresh — see this hook's own doc comment for why that otherwise silently resets. Scoped to this booking's vehicle so refreshing on a different booking's page never shows a stale, unrelated vehicle's last-saved view. */
  const { savedView: savedMapView, onViewChange: handleMapViewChange } = useMapViewSnapshot(`booking-details-map:${booking?.vehicle ?? ""}`);
  /** Admin-only "Live" toggle on the map (see LeafletMap's liveToggle prop) — same push-based Realtime mechanism as FleetManagementPage.tsx's own Live toggle (see VehicleContext.tsx's useSetLiveTracking), just for this one vehicle: `position` above already re-derives live from gpsPositions on every render, so turning the shared broadcast listener on is all this page needs to do. Persisted across a genuine refresh via useReloadPersistedBoolean, same as FleetManagementPage's own liveEnabled — scoped to this booking's vehicle so refreshing on a different booking's page never inherits a stale on/off state. */
  const [liveEnabled, setLiveEnabled] = useReloadPersistedBoolean(`booking-details-live:${booking?.vehicle ?? ""}`, false);
  const setLiveTracking = useSetLiveTracking();
  const refreshVehicles = useRefreshVehicles();
  useEffect(() => {
    setLiveTracking(liveEnabled);
    if (liveEnabled) void refreshVehicles();
    return () => setLiveTracking(false);
  }, [liveEnabled, setLiveTracking, refreshVehicles]);

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
    // admin/FLEETii admin always get both Lås/Lås op buttons enabled,
    // regardless of the booking's own window — unlike BookingPage.tsx
    // (role "user" only), which never sets this.
    isAdminLock: isAdmin,
    useUserIdent,
    userId: profile?.user_id,
    afdelingId,
  });
  /** "Slet reservation" is always shown for role=admin; for role=user, only when Tillad_slet_reservation is true for this department. */
  const canShowDeleteButton = isAdmin || userMayDeleteBooking;
  /** "Rediger reservation" is always shown for role=admin; for role=user, only when Tillad_rediger_reservation is true for this department. */
  const canShowEditButton = isAdmin || userMayEditBooking;

  /** "Kunde/afdeling:" row's data — this booking's own department (booking.departmentId) plus its costumer's name, fetched fresh rather than trusted from router state (unlike ConfirmPage, which resolves it once at booking-creation time and passes it straight through — a booking viewed here may be old, or reached by direct fetch-by-id, with no such state at all). departments'/costumers' SELECT RLS is unrestricted for any authenticated user, same as PageHeader's own "Skift afdeling" list. */
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
  /** "Kunde/afdeling:" row's display text — "Kunde / Afdeling" (space-slash-space), same format as ConfirmPage's own read-only summary row and PageHeader's "Skift afdeling" dropdown. */
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
      <div className="flex h-svh items-center justify-center bg-brand-50 text-brand-600">Indlæser reservation…</div>
    ) : null;
  }

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
              <h2 className="text-xl font-semibold text-brand-800">Reservationsdetaljer</h2>

              {/* shrink-0: a flex item with overflow-hidden gets an automatic min-height of 0 (CSS spec behavior) — without this, vertical space pressure in the flex column can squeeze this whole box to zero height, silently clipping every row even though the DOM/data is correct. */}
              <div className="shrink-0 overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Periode:</label>
                    <span className="text-sm text-brand-800">{formatBookingPeriod(booking, true)}</span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Kunde/afdeling:</label>
                    <span className="text-sm text-brand-800">{departmentLabel}</span>
                  </div>
                  {isAdmin && (
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">Bruger:</label>
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
                    </div>
                  )}
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Anvendelse:</label>
                    <span className="text-sm text-brand-800">{booking.use}</span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center justify-between text-sm font-medium text-brand-700">
                      Køretøj:
                      {vehicleLocked !== null && <LockStatusIcon locked={vehicleLocked} />}
                    </label>
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
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-red-700">
                          Blokeret
                        </span>
                      )}
                    </span>
                  </div>
                  {/* Kilometerstand and Status are only shown to admin/FLEETii admin — a regular user's own reservation doesn't need this level of vehicle-condition detail. */}
                  {isAdmin && (
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">Kilometerstand:</label>
                      <span className="text-sm text-brand-800">
                        {twoHireVehicle?.distanceCovered ? formatKilometerstand(twoHireVehicle.distanceCovered) : "—"}
                        {twoHireVehicle?.distanceCoveredUpdatedAt
                          ? ` (${shortSignalTimestamp(twoHireVehicle.distanceCoveredUpdatedAt)})`
                          : ""}
                      </span>
                    </div>
                  )}
                  {/* Drivmiddelniveau (fuel/battery %) is appended onto this same row rather than shown as its own — the two are closely related enough not to need a separate label. */}
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Drivmiddel:</label>
                    <span className="text-sm text-brand-800">
                      {vehicleIdentInfo?.drivmiddel ?? "—"}
                      {twoHireVehicle?.autonomyPercentage
                        ? ` ${twoHireVehicle.autonomyPercentage}${isAdmin && twoHireVehicle.autonomyPercentageUpdatedAt ? ` (${shortSignalTimestamp(twoHireVehicle.autonomyPercentageUpdatedAt)})` : ""}`
                        : ""}
                    </span>
                  </div>
                  {isAdmin && (
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
                  )}
                </div>
              </div>

              {mapVisible && (
                <div className="flex min-h-0 flex-1 flex-col gap-1">
                  <div className="relative isolate min-h-[12rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                    <LeafletMap
                      lat={savedMapView?.lat ?? position?.lat ?? DENMARK_CENTER.lat}
                      lng={savedMapView?.lng ?? position?.lng ?? DENMARK_CENTER.lng}
                      zoom={savedMapView?.zoom ?? (position ? 17 : 7)}
                      markerLat={position?.lat ?? DENMARK_CENTER.lat}
                      markerLng={position?.lng ?? DENMARK_CENTER.lng}
                      onViewChange={handleMapViewChange}
                      showMarker={Boolean(position)}
                      markerTooltip={twoHireVehicle?.plate ?? booking.vehicle}
                      onMarkerClick={goToVehicleDetails}
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

                  {/* Reverse-geocoded address of the map position above — see VehicleDetailsPage.tsx's identical row for why this styling/placement. Only rendered with a real GPS fix. */}
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

              {/* Afslut/Rediger/Slet, all on one row (labels shortened from "... reservation" since the section they're in already makes that context clear). */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowFinishConfirm(true)}
                  disabled={!canFinishBooking || isFinishing}
                  className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Afslut
                </button>
                {canShowEditButton && (
                  <button
                    type="button"
                    onClick={goToEditBooking}
                    className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                  >
                    Rediger
                  </button>
                )}
                {canShowDeleteButton && (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={isCancelling}
                    className="flex-1 rounded-lg border-2 border-red-600 bg-white px-2 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCancelling ? "Aflyser…" : "Slet"}
                  </button>
                )}
              </div>

              {lockError && <p className="text-sm text-red-600">{lockError}</p>}
              {locateError && <p className="text-sm text-red-600">{locateError}</p>}

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </section>
        </motion.main>
      </div>

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
    </div>
  );
}
