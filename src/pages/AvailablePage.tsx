import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { supabase } from "../lib/supabase";
import {
  VEHICLE_ID_COLUMN,
  computeFreePeriod,
  formatFreePeriod,
  isVehicleAvailable,
  type BookingWindow,
} from "../lib/bookings";

type AvailableVehicle = {
  id: string;
  vehicle: string;
  plate: string;
  ledigPeriode: string;
};

function nowIsoString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

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

function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function AvailablePage() {
  const { signOut, profile, afdeling } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { user?: string; use?: string; start?: string; end?: string } | null;
  const bruger = state?.user ?? "";
  const anvendelse = state?.use ?? "";
  const reservationStart = state?.start ? new Date(state.start) : null;
  const reservationEnd = state?.end ? new Date(state.end) : null;

  const [bookings, setBookings] = useState<BookingWindow[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);

  useEffect(() => {
    supabase
      .from("Bookings")
      .select(`${VEHICLE_ID_COLUMN}, start, end`)
      .then(({ data }) => {
        setBookings((data ?? []) as BookingWindow[]);
        setLoadingBookings(false);
      });
  }, []);

  const referenceStart = state?.start ?? nowIsoString();
  const referenceEnd = state?.end ?? nowIsoString();

  const twoHireVehicles = use2hireVehicle();
  const availableVehicles: AvailableVehicle[] = twoHireVehicles
    .filter((v) => v.tags === afdeling)
    .filter((v) => isVehicleAvailable(v.alias, bookings, state?.start ?? null, state?.end ?? null))
    .map((v) => {
      const freePeriod = computeFreePeriod(v.alias, bookings, referenceStart, referenceEnd);
      return {
        id: v.vehicleId,
        vehicle: `${v.brand} ${v.model}`,
        plate: v.alias,
        ledigPeriode: freePeriod === null ? "Ingen bookinger" : formatFreePeriod(freePeriod),
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

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-h-0 flex-1 flex-col"
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

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-brand-800">Ledige køretøjer</h2>
                {reservationStart && reservationEnd && (
                  <span className="text-[0.7rem] text-brand-600">
                    Periode: {formatDanishDateTime(reservationStart)} -{" "}
                    {isSameDate(reservationStart, reservationEnd)
                      ? formatDanishTime(reservationEnd)
                      : formatDanishDateTime(reservationEnd)}
                  </span>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border border-brand-100">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_10rem] bg-brand-50 px-1 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <div className="truncate border-r border-brand-200 pr-1">Køretøj</div>
                    <div className="truncate px-1 text-center">Ledig periode</div>
                  </div>

                  <div className="divide-y divide-brand-100 bg-white">
                    {loadingBookings && (
                      <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Henter ledige køretøjer…</div>
                    )}
                    {!loadingBookings && availableVehicles.length === 0 && (
                      <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Ingen ledige køretøjer.</div>
                    )}
                    {!loadingBookings &&
                      availableVehicles.map((vehicle, index) => {
                      const selected = selectedVehicleId === vehicle.id;
                      const isAlternate = index % 2 === 1;
                      return (
                        <button
                          key={vehicle.id}
                          type="button"
                          onClick={() => setSelectedVehicleId(vehicle.id)}
                          className={`grid w-full grid-cols-[minmax(0,1fr)_10rem] px-1 py-0.5 text-left text-[0.7rem] transition ${
                            selected
                              ? "bg-brand-100 text-brand-800"
                              : index === 0
                                ? "bg-white text-brand-700 hover:bg-brand-50"
                                : isAlternate
                                  ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                                  : "bg-white text-brand-700 hover:bg-brand-50"
                          }`}
                        >
                          <div className="truncate border-r border-brand-100 pr-1 font-medium">{`${vehicle.plate}: ${vehicle.vehicle}`}</div>
                          <div className="truncate px-1 text-center">{vehicle.ledigPeriode}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
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
                  className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
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
