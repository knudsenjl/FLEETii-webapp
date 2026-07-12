import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { supabase } from "../lib/supabase";
import { DEPARTMENT_COLUMN, VEHICLE_ID_COLUMN, isVehicleAvailable, type BookingWindow } from "../lib/bookings";

type ReservationVehicle = {
  id: string;
  vehicle: string;
  plate: string;
};

export function ConfirmPage() {
  const { signOut, session, profile, afdeling } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as
    | { vehicle?: ReservationVehicle; user?: string; use?: string; start?: string; end?: string }
    | null;
  const vehicle = state?.vehicle ?? null;
  const bruger = state?.user ?? "";
  const anvendelse = state?.use ?? "";
  const reservationStart = state?.start ?? null;
  const reservationEnd = state?.end ?? null;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicle) {
      navigate("/available", { replace: true });
    }
  }, [vehicle, navigate]);

  if (!vehicle) {
    return null;
  }

  const formatDanishDateTime = (isoDateTime: string) => {
    const [date, time] = isoDateTime.split("T");
    const [year, month, day] = date.split("-");
    return `${day}.${month}.${year} ${time.slice(0, 5)}`;
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);

    const { data: existingBookings, error: fetchError } = await supabase
      .from("Bookings")
      .select(`${VEHICLE_ID_COLUMN}, start, end`);

    if (fetchError) {
      setError(fetchError.message);
      setIsSubmitting(false);
      return;
    }

    const stillAvailable = isVehicleAvailable(
      vehicle.plate,
      (existingBookings ?? []) as BookingWindow[],
      reservationStart,
      reservationEnd,
    );

    if (!stillAvailable) {
      setError("Køretøjet er ikke længere ledigt i den valgte periode.");
      setIsSubmitting(false);
      return;
    }

    const { error: insertError } = await supabase.from("Bookings").insert({
      [VEHICLE_ID_COLUMN]: vehicle.plate,
      start: reservationStart,
      end: reservationEnd,
      usage: anvendelse,
      user: bruger || session?.user.email || null,
      [DEPARTMENT_COLUMN]: afdeling,
    });

    if (insertError) {
      setError(insertError.message);
      setIsSubmitting(false);
      return;
    }

    navigate(profile?.role === "admin" ? "/allbookings" : "/bookings", { replace: true });
  };

  const rows: [string, string][] = [
    ["Reserveret til:", bruger],
    ["Anvendelse:", anvendelse],
    ["Køretøj:", `${vehicle.plate}: ${vehicle.vehicle}`],
    ["Start:", reservationStart ? formatDanishDateTime(reservationStart) : ""],
    ["Slut:", reservationEnd ? formatDanishDateTime(reservationEnd) : ""],
  ];

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
                <button
                  type="button"
                  onClick={() => navigate("/about")}
                  aria-label="Om FLEETii"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-white font-serif text-base font-bold italic text-brand-700 transition hover:bg-brand-50"
                >
                  i
                </button>
              </div>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.email ?? "—"}</p>
              <p className="shrink-0 truncate text-[0.7rem] font-medium text-brand-600">Afdeling: {afdeling ?? "—"}</p>
            </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">Ny reservation</h2>

              <div className="overflow-hidden rounded-none border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  {rows.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[0.4fr_1fr] px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">{label}</div>
                      <div className="whitespace-nowrap px-1">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/available")}
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Annuller
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? "Bekræfter…" : "Bekræft reservation"}
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
