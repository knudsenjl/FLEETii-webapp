import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireGPS, use2hireVehicle } from "../contexts/VehicleContext";
import {
  BOOKINGS_SELECT_COLUMNS,
  DEPARTMENT_COLUMN,
  USER_ID_COLUMN,
  formatBookingPeriod,
  formatVehicleIdentLabel,
  formatVehicleLabel,
  isMapVisible,
  mapBookingRow,
  nowIsoString,
  resolveVehicleGpsPosition,
  type BookingRow,
} from "../lib/bookings";
import { PageHeader } from "../components/PageHeader";
import { CarGlyph } from "../components/CarGlyph";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HeadlightIcon } from "../components/HeadlightIcon";
import { HornIcon } from "../components/HornIcon";
import { InlinePopup } from "../components/InlinePopup";
import { LeafletMap } from "../components/LeafletMap";
import { VehicleLockToggle } from "../components/VehicleLockToggle";
import { useBookingLifecycle, type LifecycleBooking } from "../hooks/useBookingLifecycle";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useMapViewSnapshot } from "../hooks/useMapViewSnapshot";
import { supabase } from "../lib/supabase";
import { useReverseGeocode } from "../lib/geocode";

/** A booking as fetched fresh on mount below (see mapBookingRow) — same shape BookingDetailsPage.tsx's own fetch-by-id fallback produces, and a superset of useBookingLifecycle's own LifecycleBooking (the extra startDate/start/endDate/end fields are display strings this page's own formatBookingPeriod call below needs). */
type BookingDetails = LifecycleBooking & {
  startDate: string;
  start: string;
  endDate: string | null;
  end: string | null;
};

/** Fallback map center used when the booked vehicle has no GPS fix. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * Landing page for role "user" ("/booking", route-gated via requireRole —
 * see RootRoute in App.tsx): fetches the viewer's OWN currently-active
 * booking, or if none, their soonest upcoming one — the same "end >= now OR
 * end is null, ordered by start ascending, take the first" query
 * BookingsPage.tsx's own query mirrors, just scoped to a single result.
 * Redirects straight to "/bookings" (replace, no flash) if the viewer has no
 * current/upcoming booking at all, matching BookingsPage's own "Ingen
 * kommende reservation." case rather than showing an empty page here.
 *
 * Mobile-first "hero card" layout (the chosen direction from a canvas
 * mock-up review, 2026-08): a big circular Lås/Lås op control
 * (VehicleLockToggle's `variant="circle"`) is the primary action, with
 * vehicle identity/Blink/Horn alongside it in the same white card;
 * Periode/Anvendelse are compact chips below, then the map, then
 * Afslut/Rediger/Slet as plain ghost links rather than full buttons — this
 * page's information hierarchy deliberately differs from
 * BookingDetailsPage.tsx (admin/FLEETii admin's equivalent view of a single
 * booking, still the original table layout), not an oversight to reconcile
 * — the two DO share their underlying actions/handlers, via
 * useBookingLifecycle.
 * Renamed from BookingNextPage (route "/booking-next") when this redesign
 * started: only "user" role lands here or on "/bookings" — admin/FLEETii
 * admin have their own separate pages (AdminFrontpage, AllBookingsPage,
 * BookingDetailsPage) and are getting their own layout brush-up later, so
 * these two stay dedicated to the user-role mobile experience rather than
 * shared, branching components.
 */
export function BookingPage() {
  const navigate = useNavigate();
  const { session, profile, afdelingId } = useAuth();
  /** Whether afdelingId's department shows the Bruger-ID value (vs. plain E-mail) in the "Bruger:" row below — see useIdentSettings' own doc comment. Same pattern as AllBookingsPage.tsx/DepartmentPage.tsx: the label is always "Bruger", only the value source swaps — who a booking belongs to is core information, not an optional extra. */
  const { useUserIdent, useVehicleIdent } = useIdentSettings(afdelingId);
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [bookingLoading, setBookingLoading] = useState(true);

  const vehicles = use2hireVehicle();
  const gpsPositions = use2hireGPS();
  const position = booking ? resolveVehicleGpsPosition(booking.vehicle, gpsPositions) : null;
  /** Time-gated to the 15-minutes-before-start through 15-minutes-after-end window (see isMapVisible) — this page is role "user" only (requireRole in App.tsx), so there's no admin-always-visible override to make here, unlike BookingDetailsPage.tsx's own use of the same map. */
  const mapVisible = booking ? isMapVisible(nowIsoString(), { start: booking.startIso, end: booking.endIso }) : false;
  /** Reverse-geocoded address of the map position below, shown in the row underneath it — see lib/geocode.ts's useReverseGeocode. */
  const { address, addressLoading } = useReverseGeocode(position, mapVisible);
  /** Restores the map's pan/zoom across a browser refresh — see this hook's own doc comment for why that otherwise silently resets. Scoped to this booking's vehicle so refreshing on a different booking's page never shows a stale, unrelated vehicle's last-saved view. */
  const { savedView: savedMapView, onViewChange: handleMapViewChange } = useMapViewSnapshot(`booking-map:${booking?.vehicle ?? ""}`);

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
    // This page is role "user" only (requireRole in App.tsx), so there's no
    // admin override to make on the Lås/Lås op buttons here, unlike
    // BookingDetailsPage.tsx's own isAdmin-gated use of the same hook.
    isAdminLock: false,
    useUserIdent,
    userId: profile?.user_id,
    afdelingId,
  });

  /** Hero card's vehicle title — "{brand} {model}", falling back to formatVehicleLabel's own plate-or-ident text while twoHireVehicle hasn't loaded yet, so it doesn't flash blank. */
  const vehicleTitle =
    booking && twoHireVehicle ? `${twoHireVehicle.brand} ${twoHireVehicle.model}` : booking ? formatVehicleLabel(booking.vehicle, vehicles) : "";
  /** Hero card's vehicle subtitle — "{ident/plate} · {drivmiddel} {fuel%}" (see formatVehicleIdentLabel for the ident-or-plate rule respecting useVehicleIdent). Omits the drivmiddel half entirely until vehicle_profiles has loaded. */
  const vehicleSubtitle =
    vehicleIdentInfo &&
    `${formatVehicleIdentLabel(vehicleIdentInfo.vehicleIdent, vehicleIdentInfo.numberPlate, useVehicleIdent)}${
      vehicleIdentInfo.drivmiddel
        ? ` · ${vehicleIdentInfo.drivmiddel}${twoHireVehicle?.autonomyPercentage ? ` ${twoHireVehicle.autonomyPercentage}` : ""}`
        : ""
    }`;

  /** Finds the viewer's own currently-active booking, or failing that their soonest upcoming one — see this page's own doc comment for why (no bookingId to link from, unlike BookingDetailsPage.tsx). Same query BookingsPage.tsx's "Næste reservation" row uses (end >= now OR end is null, ordered by start ascending), just limited to the single first result and scoped to this viewer only (no admin cross-department branch — this page is reached only as role "user"'s landing page). */
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !afdelingId) {
      setBookingLoading(false);
      return;
    }

    let cancelled = false;
    setBookingLoading(true);
    void supabase
      .from("bookings")
      .select(BOOKINGS_SELECT_COLUMNS)
      // "end >= now" OR "end is null" — a plain .gte() would silently drop
      // every open-ended booking, since NULL >= x is NULL/falsy in Postgres
      // (same reasoning as BookingsPage.tsx's identical query).
      .or(`end.gte.${nowIsoString()},end.is.null`)
      // Scope to the viewer's OWN bookings only, same as BookingsPage.tsx's
      // identical query — without this, RLS alone decides which rows are
      // visible (department-wide, not just this user's), so the "earliest
      // upcoming" row picked here could be a DIFFERENT employee's booking
      // rather than the viewer's own.
      .eq(USER_ID_COLUMN, userId)
      // ALSO scope to the viewer's CURRENT department, matching
      // BookingsPage.tsx's departmentBookings filter (activeBookings.filter
      // by afdelingId) — a user can have old bookings still on record under
      // a department they've since moved on from (e.g. after a transfer);
      // without this, the earliest-starting one of those could outrank a
      // genuinely current booking in the user's actual department, since
      // ordering is by start date alone.
      .eq(DEPARTMENT_COLUMN, afdelingId)
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
  }, [session?.user.id, afdelingId]);

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
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 text-brand-900">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-4 pt-4"
      >
        <PageHeader compact />

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pb-4">
          {/* Hero card: vehicle (tap through to VehicleDetailsPage) + big circular lock control + Blink/Horn, the mobile-first landing page's primary controls. */}
          <div className="flex flex-col items-center gap-3.5 rounded-3xl border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5">
            <div className="flex w-full items-center gap-2.5">
              <button
                type="button"
                onClick={goToVehicleDetails}
                disabled={!twoHireVehicle}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-base font-semibold text-brand-800">{vehicleTitle}</span>
                  <span className="truncate text-xs text-brand-500">{vehicleSubtitle}</span>
                  {vehicleIdentInfo?.blocked && (
                    <span className="mt-0.5 w-fit rounded bg-red-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-red-700">
                      Blokeret
                    </span>
                  )}
                </div>
                {/* Green when 2hire's "trip_detected" signal is currently true for this vehicle (see liveVehicleDataSource.ts's tripDetected mapping) — brand-colored otherwise, same as before this signal existed. */}
                <CarGlyph
                  className={`h-7 w-11 shrink-0 ${twoHireVehicle?.tripDetected === "TRUE" ? "text-green-600" : "text-brand-600"}`}
                />
              </button>
              {/* Always goes to the full list — this landing page only ever shows ONE booking (the viewer's current/next), so "Alle" ("all") is the way to see everything else. */}
              <button
                type="button"
                onClick={() => navigate("/bookings")}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-100"
              >
                Alle
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                  <path d="M5 12h14" />
                  <path d="m13 5 7 7-7 7" />
                </svg>
              </button>
            </div>

            <VehicleLockToggle
              variant="circle"
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

            <div className="flex w-full gap-2.5">
              <div className="group relative flex-1">
                <button
                  type="button"
                  onClick={() => void handleLocate()}
                  disabled={isLocating}
                  className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2 py-2 text-xs font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <HeadlightIcon className="h-4 w-4" />
                  {isLocating ? "Blinker…" : "Blink"}
                </button>
                <InlinePopup visible={lockConfirmationKey === "located"} message="Lygterne blinker" />
              </div>
              <div className="group relative flex-1">
                <button
                  type="button"
                  onClick={handleHonk}
                  className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2 py-2 text-xs font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  <HornIcon className="h-4 w-4" />
                  Horn
                </button>
                <InlinePopup visible={lockConfirmationKey === "horn"} message="Endnu ikke implementeret" />
              </div>
            </div>
          </div>

          {/* Info chips: Periode keeps its natural content width, Anvendelse grows to fill the rest of the row so its right edge always lands on the hero card's right edge above. */}
          <div className="flex gap-2">
            <div className="shrink-0 rounded-2xl border border-brand-100 bg-white px-3.5 py-2">
              <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-brand-300">Periode</p>
              <p className="whitespace-nowrap text-xs font-semibold text-brand-800">{formatBookingPeriod(booking, true)}</p>
            </div>
            <div className="min-w-0 flex-1 rounded-2xl border border-brand-100 bg-white px-3.5 py-2">
              <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-brand-300">Anvendelse</p>
              <p className="truncate text-xs font-semibold text-brand-800">{booking.use}</p>
            </div>
          </div>

          {mapVisible && (
            <div className="flex flex-col gap-1.5">
              <div className="relative isolate h-52 overflow-hidden rounded-2xl border border-brand-100">
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

          {/* Afslut/Rediger/Slet as the same bordered-pill style as Blink/Horn above (labels shortened from "... reservation" since the page context already makes that clear) — Slet gets the red variant since it's the destructive one. */}
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setShowFinishConfirm(true)}
              disabled={!canFinishBooking || isFinishing}
              className="min-h-11 flex-1 rounded-full border border-brand-200 bg-white text-xs font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Afslut
            </button>
            {userMayEditBooking && (
              <button
                type="button"
                onClick={goToEditBooking}
                className="min-h-11 flex-1 rounded-full border border-brand-200 bg-white text-xs font-semibold text-brand-700 transition hover:bg-brand-50"
              >
                Rediger
              </button>
            )}
            {userMayDeleteBooking && (
              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                disabled={isCancelling}
                className="min-h-11 flex-1 rounded-full border-2 border-red-600 bg-white text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCancelling ? "Aflyser…" : "Slet"}
              </button>
            )}
          </div>

          {lockError && <p className="text-sm text-red-600">{lockError}</p>}
          {locateError && <p className="text-sm text-red-600">{locateError}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </motion.div>

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
