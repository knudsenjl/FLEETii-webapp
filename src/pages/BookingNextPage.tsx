import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireGPS, use2hireVehicle } from "../contexts/VehicleContext";
import {
  BOOKING_ID_COLUMN,
  BOOKINGS_SELECT_COLUMNS,
  USER_ID_COLUMN,
  formatBookingPeriod,
  formatVehicleIdentLabel,
  formatVehicleLabel,
  isMapVisible,
  isoPrefix,
  mapBookingRow,
  nowIsoString,
  resolveVehicleGpsPosition,
  shortSignalTimestamp,
  toDisplayVehicle,
  userAnsatId,
  type BookingRow,
  type EditingBooking,
} from "../lib/bookings";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HeadlightIcon } from "../components/HeadlightIcon";
import { HornIcon } from "../components/HornIcon";
import { InlinePopup } from "../components/InlinePopup";
import { LeafletMap } from "../components/LeafletMap";
import { LockStatusIcon } from "../components/LockStatusIcon";
import { VehicleLockToggle } from "../components/VehicleLockToggle";
import { useVehicleLockState } from "../hooks/useVehicleLockState";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { useLocateVehicle } from "../hooks/useLocateVehicle";
import { supabase } from "../lib/supabase";
import { isSettingTilladt } from "../lib/settings";
import { useReverseGeocode } from "../lib/geocode";

/** A booking as fetched fresh on mount below (see mapBookingRow) — same shape BookingDetailsPage.tsx's own fetch-by-id fallback produces. */
type BookingDetails = {
  id: string;
  vehicle: string;
  startDate: string;
  start: string;
  endDate: string | null;
  end: string | null;
  startIso: string;
  endIso: string | null;
  use: string;
  userId: string | null;
  userEmail: string | null;
  userIdent: string | null;
  /** References departments.department_id — NOT a department name. Threaded into EditingBooking (goToEditBooking below) so ReservationPage's "Kunde/afdeling" picker can pre-fill to this booking's own current department for a FLEETii admin, instead of starting unset. */
  departmentId: string | null;
};

/** Fallback map center used when the booked vehicle has no GPS fix. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * Landing page for role "user" ("/booking-next", see RootRoute in App.tsx —
 * admin/FLEETii admin still land on "/admin"). A copy of
 * BookingDetailsPage.tsx, adapted to be reachable with no booking to link
 * from: rather than a "/booking-details/:bookingId" route param or router
 * state, it fetches the viewer's OWN currently-active booking, or if none,
 * their soonest upcoming one — the same "end >= now OR end is null, ordered
 * by start ascending, take the first" query BookingsPage.tsx's own
 * "Næste reservation" row uses, just scoped to a single result. Redirects
 * straight to "/bookings" (replace, no flash) if the viewer has no
 * current/upcoming booking at all, matching BookingsPage's own "Ingen
 * kommende reservation." case rather than showing an empty page here.
 *
 * Differs from BookingDetailsPage.tsx in exactly two other ways (both
 * intentional, not omissions): the header reads "Reservation" with a "Next"
 * button (→ "/bookings", so the user can always reach the full list from
 * here) instead of "Reservationsdetaljer", and the "Kunde/afdeling:" row is
 * dropped — both requested specifically for this landing-page variant.
 * Everything else (map, Lås/Lås op, Blink/Horn, Afslut/Rediger/Slet) is
 * unchanged from BookingDetailsPage.tsx; keep the two in sync by hand if one
 * changes, since they're deliberately not sharing a component.
 */
export function BookingNextPage() {
  const navigate = useNavigate();
  const { session, profile, afdelingId } = useAuth();
  /** Whether afdelingId's department shows the Bruger-ID value (vs. plain E-mail) in the "Bruger:" row below — see useIdentSettings' own doc comment. Same pattern as AllBookingsPage.tsx/DepartmentPage.tsx: the label is always "Bruger", only the value source swaps — who a booking belongs to is core information, not an optional extra. */
  const { useUserIdent, useVehicleIdent } = useIdentSettings(afdelingId);
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [bookingLoading, setBookingLoading] = useState(true);

  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const vehicles = use2hireVehicle();
  const gpsPositions = use2hireGPS();
  const position = booking ? resolveVehicleGpsPosition(booking.vehicle, gpsPositions) : null;
  const twoHireVehicle = booking ? vehicles.find((v) => v.vehicleId === booking.vehicle) : undefined;
  const isAdmin = profile?.role === "admin" || profile?.role === "FLEETii admin";
  /** Only within the same window the map itself is shown (see isMapVisible below) — no point reverse-geocoding a position that isn't currently displayed. */
  const mapVisible = booking ? isMapVisible(nowIsoString(), { start: booking.startIso, end: booking.endIso }) : false;
  /** Reverse-geocoded address of the map position below, shown in the row underneath it — see lib/geocode.ts's useReverseGeocode. Not admin-gated, unlike VehicleDetailsPage's own use of this hook: the map itself is shown to a regular user for their own booking, so the address is too. */
  const { address, addressLoading } = useReverseGeocode(position, mapVisible);

  /** The genuine Køretøj-ID/Nummerplade pair (plus Drivmiddel and blocked-state) for this booking's vehicle — fetched straight from vehicle_profiles rather than reusing vehicle.plate (see liveVehicleDataSource.ts's toVehicle2Hire), since that field is an UNGATED vehicle_ident-or-number_plate fallback and the "Køretøj:" row below must respect useVehicleIdent. `blocked` (from blocked_at, see VehicleDetailsPage.tsx's "Bloker køretøj") drives the "Blokeret" badge on that row. */
  const [vehicleIdentInfo, setVehicleIdentInfo] = useState<{
    vehicleIdent: string | null;
    numberPlate: string | null;
    drivmiddel: string | null;
    blocked: boolean;
  } | null>(null);
  useEffect(() => {
    if (!booking) return;

    let cancelled = false;
    void supabase
      .from("vehicle_profiles")
      .select("vehicle_ident, number_plate, drivmiddel, blocked_at")
      .eq("vehicle_id", booking.vehicle)
      .maybeSingle<{ vehicle_ident: string | null; number_plate: string | null; drivmiddel: string | null; blocked_at: string | null }>()
      .then(({ data }) => {
        if (cancelled) return;
        setVehicleIdentInfo(
          data
            ? {
                vehicleIdent: data.vehicle_ident,
                numberPlate: data.number_plate,
                drivmiddel: data.drivmiddel,
                blocked: data.blocked_at !== null,
              }
            : null,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [booking?.vehicle]);

  /** "Køretøj:" row's identifying text — "{ident} / {plate}: {brand} {model}" (see formatVehicleIdentLabel) when useVehicleIdent and vehicle_ident are both set, else just "{plate}: {brand} {model}". Falls back to formatVehicleLabel's own plate (which is itself ident-or-plate, ungated) while vehicle_profiles hasn't loaded yet, so the row doesn't flash blank. */
  const vehicleLabel =
    booking && vehicleIdentInfo && twoHireVehicle
      ? `${formatVehicleIdentLabel(vehicleIdentInfo.vehicleIdent, vehicleIdentInfo.numberPlate, useVehicleIdent)}: ${twoHireVehicle.brand} ${twoHireVehicle.model}`
      : booking
        ? formatVehicleLabel(booking.vehicle, vehicles)
        : "";

  /** "Slet reservation" is always shown for role=admin; for role=user, only when Tillad_slet_reservation is true for this department. */
  const [userMayDeleteBooking, setUserMayDeleteBooking] = useState(false);
  const canShowDeleteButton = isAdmin || userMayDeleteBooking;

  /** "Rediger reservation" is always shown for role=admin; for role=user, only when Tillad_rediger_reservation is true for this department. */
  const [userMayEditBooking, setUserMayEditBooking] = useState(false);
  const canShowEditButton = isAdmin || userMayEditBooking;

  const {
    locked: vehicleLocked,
    lockEnabled,
    unlockEnabled,
    loading: lockStateLoading,
    setLock,
    error: lockError,
  } = useVehicleLockState(
    booking?.vehicle ?? "",
    booking ? { bookingId: booking.id, startIso: booking.startIso, endIso: booking.endIso } : null,
    isAdmin,
  );
  /** "Køretøjet er nu låst/låst op"/"Lygterne blinker" confirmation shown for 3s right after a successful setLock/locate — see the Lås/Lås op and "Blink" buttons below. */
  const { activeKey: lockConfirmationKey, trigger: triggerLockConfirmation } = useTimedFlag();
  const { isLocating, locateError, locate } = useLocateVehicle();

  useEffect(() => {
    void isSettingTilladt("Tillad_slet_reservation", profile?.user_id, afdelingId).then(setUserMayDeleteBooking);
  }, [profile?.user_id, afdelingId]);

  useEffect(() => {
    void isSettingTilladt("Tillad_rediger_reservation", profile?.user_id, afdelingId).then(setUserMayEditBooking);
  }, [profile?.user_id, afdelingId]);

  /** Finds the viewer's own currently-active booking, or failing that their soonest upcoming one — see this page's own doc comment for why (no bookingId to link from, unlike BookingDetailsPage.tsx). Same query BookingsPage.tsx's "Næste reservation" row uses (end >= now OR end is null, ordered by start ascending), just limited to the single first result and scoped to this viewer only (no admin cross-department branch — this page is reached only as role "user"'s landing page). */
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) {
      setBookingLoading(false);
      return;
    }

    let cancelled = false;
    setBookingLoading(true);
    void supabase
      .from("bookings")
      .select(BOOKINGS_SELECT_COLUMNS)
      .eq(USER_ID_COLUMN, userId)
      // "end >= now" OR "end is null" — a plain .gte() would silently drop
      // every open-ended booking, since NULL >= x is NULL/falsy in Postgres
      // (same reasoning as BookingsPage.tsx's identical query).
      .or(`end.gte.${nowIsoString()},end.is.null`)
      .order("start", { ascending: true })
      .limit(1)
      .returns<BookingRow[]>()
      .then(({ data }) => {
        if (cancelled) return;
        setBooking(data && data.length > 0 ? mapBookingRow(data[0]) : null);
        setBookingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

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

  /** Every role can navigate to VehicleDetailsPage — both from the "Køretøj:" row link below and the map marker — matching VehicleDetailsPage's own doc comment, which already accounts for a regular user landing there via their own booking (its map/edit/delete actions stay separately admin-gated within that page itself). */
  const goToVehicleDetails = () => {
    if (!twoHireVehicle) return;
    navigate(`/vehicle-details/${twoHireVehicle.vehicleId}`, {
      state: {
        vehicle: toDisplayVehicle(twoHireVehicle),
        booking: { id: booking.id, startIso: booking.startIso, endIso: booking.endIso },
      },
    });
  };

  /** Starts the "Rediger reservation" flow: back through ReservationPage -> (optionally) AvailablePage -> ConfirmPage, pre-filled with this booking's current bruger/anvendelse/start/end/vehicle, updating this row (by booking_id) instead of inserting a new one. vehicleId is carried through to AvailablePage so this booking's current vehicle bypasses the department filter there (see AvailablePage's availableVehicles) even outside the editing admin's own department. */
  const goToEditBooking = () => {
    const editing: EditingBooking = {
      bookingId: booking.id,
      userId: booking.userId,
      userLabel: useUserIdent ? userAnsatId(booking) : booking.userEmail,
      anvendelse: booking.use,
      startIso: booking.startIso,
      endIso: booking.endIso,
      vehicleId: booking.vehicle,
      departmentId: booking.departmentId,
    };
    navigate("/reservation", { state: { editing } });
  };

  /** Deletes this booking and returns to the bookings list. */
  const handleCancelBooking = async () => {
    setIsCancelling(true);
    setError(null);

    const { error: deleteError } = await supabase.from("bookings").delete().eq(BOOKING_ID_COLUMN, booking.id);

    if (deleteError) {
      setError(deleteError.message);
      setIsCancelling(false);
      setShowCancelConfirm(false);
      return;
    }

    navigate("/bookings", { replace: true });
  };

  /** "Afslut reservation" is enabled only within the booking's own period — from its start until its end (or always, for an open-ended booking), same wall-clock comparison as computeLockButtonState. */
  const nowPrefix = isoPrefix(nowIsoString());
  const bookingStarted = nowPrefix >= isoPrefix(booking.startIso);
  const bookingExpired = booking.endIso !== null && nowPrefix >= isoPrefix(booking.endIso);
  const canFinishBooking = bookingStarted && !bookingExpired;

  /** "Blink": sends 2hire's real "locate" command via useLocateVehicle — same audience as Lås/Lås op (any user with a relevant booking, see 2hire-vehicle-command.mts's own doc comment on the auth split). */
  const handleLocate = async () => {
    const success = await locate(booking.vehicle);
    if (success) triggerLockConfirmation("located");
  };

  /** "Horn": intentionally a stub — 2hire's generic-command API doesn't have a confirmed horn/honk command yet (see 2hire-vehicle-command.mts), so this just surfaces "Endnu ikke implementeret" until the right command is found. Reuses the same lockConfirmationKey as Lås/Lås op/Blink rather than a second useTimedFlag instance, since only one of these popups is ever relevant at a time. */
  const handleHonk = () => {
    triggerLockConfirmation("horn");
  };

  /** Ends this booking early: locks the vehicle, then sets its "end" to now — unlike "Slet reservation", the booking row itself isn't deleted, just shortened to end at this moment. If locking fails, the booking is left untouched (see useVehicleLockState's own error, shown below the Lås/Lås op buttons) rather than shortening a booking whose vehicle didn't actually get secured. */
  const handleFinishBooking = async () => {
    setIsFinishing(true);
    setError(null);

    const lockSuccess = await setLock(true);
    if (!lockSuccess) {
      setIsFinishing(false);
      setShowFinishConfirm(false);
      return;
    }

    const { error: updateError } = await supabase.from("bookings").update({ end: nowIsoString() }).eq(BOOKING_ID_COLUMN, booking.id);

    if (updateError) {
      setError(updateError.message);
      setIsFinishing(false);
      setShowFinishConfirm(false);
      return;
    }

    navigate("/bookings", { replace: true });
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
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-brand-800">Reservation</h2>
                {/* Always goes to the full list — this landing page only ever shows ONE booking (the viewer's current/next), so "Next" is the way to see everything else. */}
                <button
                  type="button"
                  onClick={() => navigate("/bookings")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Next
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M5 12h14" />
                    <path d="m13 5 7 7-7 7" />
                  </svg>
                </button>
              </div>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Periode:</label>
                    <span className="text-sm text-brand-800">{formatBookingPeriod(booking, true)}</span>
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
                        {twoHireVehicle?.distanceCovered ?? "—"}
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
                          ? ` (opdateret ${shortSignalTimestamp(twoHireVehicle.onlineUpdatedAt)})`
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
                      lat={position?.lat ?? DENMARK_CENTER.lat}
                      lng={position?.lng ?? DENMARK_CENTER.lng}
                      zoom={position ? 17 : 7}
                      showMarker={Boolean(position)}
                      markerTooltip={twoHireVehicle?.plate ?? booking.vehicle}
                      onMarkerClick={goToVehicleDetails}
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
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
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
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Afslut
                </button>
                {canShowEditButton && (
                  <button
                    type="button"
                    onClick={goToEditBooking}
                    className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Rediger
                  </button>
                )}
                {canShowDeleteButton && (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={isCancelling}
                    className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
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
