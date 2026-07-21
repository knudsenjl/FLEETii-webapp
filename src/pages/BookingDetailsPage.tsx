import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireGPS, use2hireVehicle } from "../contexts/VehicleContext";
import {
  BOOKING_ID_COLUMN,
  formatBookingPeriod,
  formatVehicleLabel,
  isMapVisible,
  nowIsoString,
  resolveVehicleGpsPosition,
  shortSignalTimestamp,
  toDisplayVehicle,
} from "../lib/bookings";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LeafletMap } from "../components/LeafletMap";
import { useVehicleLockState } from "../hooks/useVehicleLockState";
import { supabase } from "../lib/supabase";
import { isSettingTilladt } from "../lib/settings";

/** A booking as passed in via router state from BookingsPage/AllBookingsPage. */
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
  userEmail: string | null;
};

/** Fallback map center used when the booked vehicle has no GPS fix. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * Reservation detail view ("/booking-details"): the booking's period/usage,
 * the vehicle's current fuel/mileage/status (looked up live from
 * VehicleContext by vehicleId, not stored on the booking itself), a map of its
 * last known position (only shown from 15 minutes before the booking's start
 * to 15 minutes after its end — see isMapVisible — outside that window it's
 * not rendered at all), and a "Slet reservation" cancel flow. The vehicle is
 * passed in via router state — there is no direct-URL/refresh support.
 */
export function BookingDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, afdelingId } = useAuth();
  const booking = (location.state as { booking?: BookingDetails } | null)?.booking ?? null;

  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const vehicles = use2hireVehicle();
  const gpsPositions = use2hireGPS();
  const position = booking ? resolveVehicleGpsPosition(booking.vehicle, gpsPositions) : null;
  const twoHireVehicle = booking ? vehicles.find((v) => v.vehicleId === booking.vehicle) : undefined;
  const isAdmin = profile?.role === "admin";

  /** "Slet reservation" is always shown for role=admin; for role=user, only when settings.Bruger_slet_reservation is ["Tilladt"] for this department. */
  const [userMayDeleteBooking, setUserMayDeleteBooking] = useState(false);
  const canShowDeleteButton = isAdmin || userMayDeleteBooking;

  const {
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

  useEffect(() => {
    void isSettingTilladt("Bruger_slet_reservation", profile?.user_id, afdelingId).then(setUserMayDeleteBooking);
  }, [profile?.user_id, afdelingId]);

  useEffect(() => {
    if (!booking) {
      navigate("/bookings", { replace: true });
    }
  }, [booking, navigate]);

  if (!booking) {
    return null;
  }

  /** Only admins can navigate from the map marker to VehicleDetailsPage (which is itself admin-gated for its map/edit/delete actions — see VehicleDetailsPage.tsx). */
  const goToVehicleDetails = isAdmin
    ? () => {
        if (!twoHireVehicle) return;
        navigate("/vehicle-details", {
          state: {
            vehicle: toDisplayVehicle(twoHireVehicle),
            booking: { id: booking.id, startIso: booking.startIso, endIso: booking.endIso },
          },
        });
      }
    : undefined;

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
              <h2 className="text-xl font-semibold text-brand-800">Reservationsdetaljer</h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Periode:</label>
                    <span className="text-sm text-brand-800" title={formatBookingPeriod(booking)}>
                      {formatBookingPeriod(booking, true)}
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">Bruger:</label>
                      <span className="text-sm text-brand-800">{booking.userEmail ?? "—"}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Anvendelse:</label>
                    <span className="text-sm text-brand-800">{booking.use}</span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Køretøj:</label>
                    <span className="text-sm text-brand-800">{formatVehicleLabel(booking.vehicle, vehicles)}</span>
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

              {isMapVisible(nowIsoString(), { start: booking.startIso, end: booking.endIso }) && (
                <div className="relative isolate min-h-[12rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                  <LeafletMap
                    lat={position?.lat ?? DENMARK_CENTER.lat}
                    lng={position?.lng ?? DENMARK_CENTER.lng}
                    zoom={position ? 17 : 7}
                    showMarker={Boolean(position)}
                    markerClickable={false}
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

              {error && <p className="text-sm text-red-600">{error}</p>}

              {canShowDeleteButton && (
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={isCancelling}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCancelling ? "Aflyser…" : "Slet reservation"}
                </button>
              )}
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
    </div>
  );
}
