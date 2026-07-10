import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { use2hireGPS, use2hireVehicle } from "../contexts/VehicleContext";
import { BOOKING_ID_COLUMN, formatVehicleLabel, resolveVehicleGpsPosition } from "../lib/bookings";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { LeafletMap } from "../components/LeafletMap";
import { InlinePopup } from "../components/InlinePopup";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";

type BookingDetails = {
  id: number;
  vehicle: string;
  startDate: string;
  start: string;
  endDate: string;
  end: string;
  use: string;
};

const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

export function BookingDetailsPage() {
  const { signOut, profile, afdeling } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const booking = (location.state as { booking?: BookingDetails } | null)?.booking ?? null;

  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();
  const vehicles = use2hireVehicle();
  const gpsPositions = use2hireGPS();
  const position = booking ? resolveVehicleGpsPosition(booking.vehicle, vehicles, gpsPositions) : null;
  const twoHireVehicle = booking ? vehicles.find((v) => v.alias === booking.vehicle) : undefined;

  useEffect(() => {
    if (!booking) {
      navigate("/bookings", { replace: true });
    }
  }, [booking, navigate]);

  if (!booking) {
    return null;
  }

  const goToVehicleDetails = () => {
    if (!twoHireVehicle) return;
    navigate("/vehicleDetails", {
      state: {
        vehicle: {
          ...twoHireVehicle,
          vehicle: `${twoHireVehicle.brand} ${twoHireVehicle.model}`,
          plate: twoHireVehicle.alias,
          department: "—",
          status: twoHireVehicle.online === "TRUE" ? "Online" : "Offline",
        },
      },
    });
  };

  const handleCancelBooking = async () => {
    setIsCancelling(true);
    setError(null);

    const { error: deleteError } = await supabase.from("Bookings").delete().eq(BOOKING_ID_COLUMN, booking.id);

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
          <div className="mb-2 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <FleetiiLogo className="h-8 w-auto shrink-0" linkToHome />
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => void signOut()}
                  className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  Log ud
                </button>
              </div>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.email ?? "—"}</p>
              <p className="shrink-0 truncate text-[0.7rem] font-medium text-brand-600">Afdeling: {afdeling ?? "—"}</p>
            </div>
          </div>

          <section className="flex flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex flex-1 flex-col gap-4">
              <h2 className="text-xl font-semibold text-brand-800">Reservationsdetaljer</h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Periode:</label>
                    <span className="text-sm text-brand-800">
                      {booking.startDate} {booking.start} -{" "}
                      {booking.startDate === booking.endDate ? booking.end : `${booking.endDate} ${booking.end}`}
                    </span>
                  </div>
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
                      {twoHireVehicle?.autonomyPercentageUpdatedAt ? ` (${twoHireVehicle.autonomyPercentageUpdatedAt})` : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Kilometerstand:</label>
                    <span className="text-sm text-brand-800">
                      {twoHireVehicle?.distanceCovered ?? "—"}
                      {twoHireVehicle?.distanceCoveredUpdatedAt ? ` (${twoHireVehicle.distanceCoveredUpdatedAt})` : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Status:</label>
                    <span className="text-sm text-brand-800">
                      {twoHireVehicle ? (twoHireVehicle.online === "TRUE" ? "Online" : "Offline") : "—"}
                      {twoHireVehicle?.onlineUpdatedAt ? ` (opdateret ${twoHireVehicle.onlineUpdatedAt})` : ""}
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative isolate min-h-[12rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                <LeafletMap
                  lat={position?.lat ?? DENMARK_CENTER.lat}
                  lng={position?.lng ?? DENMARK_CENTER.lng}
                  zoom={position ? 13 : 7}
                  showMarker={Boolean(position)}
                  markerClickable={false}
                  markerTooltip={booking.vehicle}
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

              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => triggerNotImplemented("laas")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Lås
                  </button>
                  <InlinePopup visible={notImplementedKey === "laas"} message="Endnu ikke implementeret" />
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => triggerNotImplemented("laas-op")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Lås op
                  </button>
                  <InlinePopup visible={notImplementedKey === "laas-op"} message="Endnu ikke implementeret" align="right" />
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                disabled={isCancelling}
                className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCancelling ? "Aflyser…" : "Slet reservation"}
              </button>
            </div>
          </section>
        </motion.main>
      </div>

      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <p className="text-sm font-medium text-brand-800">
              Er du sikker på, at du vil aflyse denne reservation?
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                disabled={isCancelling}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Nej
              </button>
              <button
                type="button"
                onClick={() => void handleCancelBooking()}
                disabled={isCancelling}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCancelling ? "Aflyser…" : "Ja"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
