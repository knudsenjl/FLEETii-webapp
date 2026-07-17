import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";
import {
  VEHICLE_ID_COLUMN,
  computeFreePeriod,
  formatFreePeriod,
  isVehicleAvailable,
  nowIsoString,
  type BookingWindow,
} from "../lib/bookings";

/** A vehicle available for the requested period, plus a human-readable description of its free window (short "dd/mm" dates for display, full "dd.mm.yyyy" dates for the hover tooltip). */
type AvailableVehicle = {
  id: string;
  vehicle: string;
  plate: string;
  ledigPeriode: string;
  ledigPeriodeFull: string;
};

function formatDanishTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDanishDateTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()} ${formatDanishTime(date)}`;
}

/** Same as formatDanishDateTime, but "dd/mm" instead of "dd.mm.yyyy" — pairs with the full version as a hover tooltip. */
function formatDanishDateTimeShort(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month} ${formatDanishTime(date)}`;
}

/** True if two Dates fall on the same calendar day (used to decide whether to repeat the date in the period display). */
function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Step 2 of the booking flow ("/available"): given the department/period
 * chosen on ReservationPage (via router state), lists every department
 * vehicle that's free for that whole period, with its actual free window
 * either side. Selecting one and pressing "Reserver" continues to
 * ConfirmPage — still no DB write at this point.
 */
export function AvailablePage() {
  const { afdeling } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { user?: string; use?: string; start?: string; end?: string } | null;
  const bruger = state?.user ?? "";
  const anvendelse = state?.use ?? "";
  const reservationStart = state?.start ? new Date(state.start) : null;
  const reservationEnd = state?.end ? new Date(state.end) : null;

  const [bookings, setBookings] = useState<BookingWindow[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [bookingsError, setBookingsError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("bookings")
      .select(`${VEHICLE_ID_COLUMN}, start, end`)
      .then(({ data, error }) => {
        if (error) {
          setBookingsError(error.message);
          setLoadingBookings(false);
          return;
        }
        setBookings((data ?? []) as BookingWindow[]);
        setLoadingBookings(false);
      });
  }, []);

  const referenceStart = state?.start ?? nowIsoString();
  const referenceEnd = state?.end ?? nowIsoString();

  const twoHireVehicles = use2hireVehicle();
  const availableVehicles: AvailableVehicle[] = twoHireVehicles
    .filter((v) => v.tags === afdeling)
    .filter((v) => isVehicleAvailable(v.vehicleId, bookings, state?.start ?? null, state?.end ?? null))
    .map((v) => {
      const freePeriod = computeFreePeriod(v.vehicleId, bookings, referenceStart, referenceEnd);
      return {
        id: v.vehicleId,
        vehicle: `${v.brand} ${v.model}`,
        plate: v.alias,
        ledigPeriode: freePeriod === null ? "Ingen bookinger" : formatFreePeriod(freePeriod, true),
        ledigPeriodeFull: freePeriod === null ? "Ingen bookinger" : formatFreePeriod(freePeriod),
      };
    });

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const selectedVehicle = availableVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-w-0 min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-w-0 min-h-0 flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex min-w-0 min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-w-0 min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-brand-800">Ledige køretøjer</h2>
                {reservationStart && reservationEnd && (
                  <span
                    className="text-[0.7rem] text-brand-600"
                    title={`${formatDanishDateTime(reservationStart)} - ${
                      isSameDate(reservationStart, reservationEnd)
                        ? formatDanishTime(reservationEnd)
                        : formatDanishDateTime(reservationEnd)
                    }`}
                  >
                    Periode: {formatDanishDateTimeShort(reservationStart)} -{" "}
                    {isSameDate(reservationStart, reservationEnd)
                      ? formatDanishTime(reservationEnd)
                      : formatDanishDateTimeShort(reservationEnd)}
                  </span>
                )}
              </div>

              <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-auto rounded-none border border-brand-100">
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <tr>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Køretøj</th>
                      <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-center">Ledig periode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {loadingBookings && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-brand-500">Henter ledige køretøjer…</td>
                      </tr>
                    )}
                    {!loadingBookings && bookingsError && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-red-600">{bookingsError}</td>
                      </tr>
                    )}
                    {!loadingBookings && !bookingsError && availableVehicles.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-brand-500">Ingen ledige køretøjer.</td>
                      </tr>
                    )}
                    {!loadingBookings &&
                      !bookingsError &&
                      availableVehicles.map((vehicle, index) => {
                        const selected = selectedVehicleId === vehicle.id;
                        const isAlternate = index % 2 === 1;
                        return (
                          <tr
                            key={vehicle.id}
                            role="button"
                            tabIndex={0}
                            aria-pressed={selected}
                            onClick={() => setSelectedVehicleId(vehicle.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedVehicleId(vehicle.id);
                              }
                            }}
                            className={`cursor-pointer transition ${
                              selected
                                ? "bg-brand-100 text-brand-800"
                                : index === 0
                                  ? "bg-white text-brand-700 hover:bg-brand-50"
                                  : isAlternate
                                    ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                                    : "bg-white text-brand-700 hover:bg-brand-50"
                            }`}
                          >
                            <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">{`${vehicle.plate}: ${vehicle.vehicle}`}</td>
                            <td className="whitespace-nowrap px-2 py-0.5 text-center" title={vehicle.ledigPeriodeFull}>
                              {vehicle.ledigPeriode}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={!selectedVehicle}
                  onClick={() =>
                    selectedVehicle &&
                    navigate("/confirm", {
                      state: {
                        vehicle: selectedVehicle,
                        user: bruger,
                        use: anvendelse,
                        start: state?.start,
                        end: state?.end,
                      },
                    })
                  }
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reserver
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
