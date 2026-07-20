import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";
import {
  DEPARTMENT_COLUMN,
  VEHICLE_ID_COLUMN,
  isVehicleAvailable,
  shortDanishDate,
  splitIsoDateTime,
  type BookingWindow,
} from "../lib/bookings";

/** The selected vehicle, as passed in via router state from AvailablePage. */
type ReservationVehicle = {
  id: string;
  vehicle: string;
  plate: string;
};

/**
 * Final step of the booking flow ("/confirm"): shows a read-only summary of
 * the reservation about to be made and, on confirmation, re-checks
 * availability (closing most of the window for a race against another
 * booking — see handleConfirm) before actually inserting the row into
 * Supabase's "bookings" table. Redirects to the fleet's/own bookings list on
 * success depending on role.
 */
export function ConfirmPage() {
  const { session, profile, afdeling } = useAuth();
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

  /** "dd.mm.yyyy HH:mm" (or "dd/mm HH:mm" when `short`) — short pairs with the full version as a hover tooltip. */
  const formatDanishDateTime = (isoDateTime: string, short = false) => {
    const { date, time } = splitIsoDateTime(isoDateTime);
    return `${short ? shortDanishDate(date) : date} ${time}`;
  };

  /**
   * Re-checks availability (the vehicle may have been booked by someone else
   * since AvailablePage loaded) and, if still free, inserts the booking. The
   * DB-level exclusion constraint (supabase/booking_overlap_constraint.sql)
   * is the actual race-proof backstop — a 23P01 (exclusion_violation) error
   * from the insert means this pre-check's race window was lost, and is
   * shown with the same friendly message as the pre-check itself.
   */
  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);

    const { data: existingBookings, error: fetchError } = await supabase
      .from("bookings")
      .select(`${VEHICLE_ID_COLUMN}, start, end`);

    if (fetchError) {
      setError(fetchError.message);
      setIsSubmitting(false);
      return;
    }

    const stillAvailable = isVehicleAvailable(
      vehicle.id,
      (existingBookings ?? []) as BookingWindow[],
      reservationStart,
      reservationEnd,
    );

    if (!stillAvailable) {
      setError("Køretøjet er ikke længere ledigt i den valgte periode.");
      setIsSubmitting(false);
      return;
    }

    // bookings.department_id is a uuid referencing departments.department_id
    // (see supabase/bookings_department_to_department_id.sql), not the
    // department name directly — afdeling (the current user's department
    // name) needs resolving to that id right before the insert.
    const { data: departmentRow, error: departmentError } = await supabase
      .from("departments")
      .select("department_id")
      .eq("name", afdeling)
      .maybeSingle<{ department_id: string }>();

    if (departmentError || !departmentRow) {
      setError("Kunne ikke finde din afdeling. Kontakt en administrator.");
      setIsSubmitting(false);
      return;
    }

    const { error: insertError } = await supabase.from("bookings").insert({
      [VEHICLE_ID_COLUMN]: vehicle.id,
      start: reservationStart,
      end: reservationEnd,
      usage: anvendelse,
      user: bruger || session?.user.email || null,
      [DEPARTMENT_COLUMN]: departmentRow.department_id,
    });

    if (insertError) {
      // 23P01 = Postgres exclusion_violation — the DB-level overlap
      // constraint (supabase/booking_overlap_constraint.sql) caught a race
      // the availability pre-check above missed (another booking for the
      // same vehicle/period was inserted in between). Show the same
      // friendly message as the pre-check instead of the raw DB error.
      setError(
        insertError.code === "23P01"
          ? "Køretøjet er ikke længere ledigt i den valgte periode."
          : insertError.message,
      );
      setIsSubmitting(false);
      return;
    }

    navigate(profile?.role === "admin" ? "/allbookings" : "/bookings", { replace: true });
  };

  /** [label, short value (visible), full value (hover tooltip)] — Start/Slut show "dd/mm" with the full "dd.mm.yyyy" available on hover; other rows just repeat the same value in both slots. */
  const rows: [string, string, string][] = [
    ["Reserveret til:", bruger, bruger],
    ["Anvendelse:", anvendelse, anvendelse],
    ["Køretøj:", `${vehicle.plate}: ${vehicle.vehicle}`, `${vehicle.plate}: ${vehicle.vehicle}`],
    [
      "Start:",
      reservationStart ? formatDanishDateTime(reservationStart, true) : "",
      reservationStart ? formatDanishDateTime(reservationStart) : "",
    ],
    [
      "Slut:",
      reservationEnd ? formatDanishDateTime(reservationEnd, true) : "Ingen slutdato",
      reservationEnd ? formatDanishDateTime(reservationEnd) : "Ingen slutdato",
    ],
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
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">Ny reservation</h2>

              <div className="overflow-hidden rounded-none border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  {rows.map(([label, shortValue, fullValue]) => (
                    <div key={label} className="grid grid-cols-[0.4fr_1fr] px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">{label}</div>
                      <div className="whitespace-nowrap px-1" title={fullValue}>{shortValue}</div>
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
