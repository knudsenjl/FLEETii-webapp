import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";
import {
  BOOKING_ID_COLUMN,
  DEPARTMENT_COLUMN,
  USER_ID_COLUMN,
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
 * booking — see handleConfirm) before actually writing to Supabase's
 * "bookings" table — inserting a new row normally, or updating the existing
 * one when reached via BookingDetailsPage's "Rediger reservation" (carries
 * editingBookingId through router state from ReservationPage/AvailablePage).
 * "Annuller" carries the full incoming state back to AvailablePage unchanged
 * (rather than dropping it), so editingBookingId/editingVehicleId survive
 * the round trip instead of stranding the admin mid-edit. Redirects to the
 * fleet's/own bookings list on success depending on role.
 *
 * departmentId (state) is the RESOLVED target department, already picked on
 * ReservationPage and carried through AvailablePage unchanged — for a
 * regular admin it's just their own afdelingId; for a FLEETii admin (no
 * afdelingId of their own) it's whatever they chose in ReservationPage's
 * own "Kunde/afdeling" row. This page has no department picker of its own —
 * it just writes whatever arrives here as the booking's department_id.
 * departmentLabel (its display-ready counterpart) is shown as the summary's
 * very first row, a final read-only "security check" so whoever's
 * confirming can double-check the department before "Bekræft" actually
 * writes it — most useful for a FLEETii admin picking among many, but shown
 * for every role.
 */
export function ConfirmPage() {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as
    | {
        vehicle?: ReservationVehicle;
        user?: string;
        userLabel?: string;
        use?: string;
        start?: string;
        end?: string;
        editingBookingId?: string;
        departmentId?: string | null;
        /** Display-ready counterpart to departmentId (ReservationPage's own resolved "Kunde/afdeling" label) — shown as the first summary row below, a final read-only "security check" before the booking is actually written. */
        departmentLabel?: string;
      }
    | null;
  const vehicle = state?.vehicle ?? null;
  // bruger is a user_id (uuid) now, not an email (see
  // supabase/bookings_user_to_user_id.sql) — brugerLabel is the display-ready
  // email ReservationPage/AvailablePage already resolved and carried through
  // via router state, so no fresh lookup is needed here just to show it.
  const bruger = state?.user ?? "";
  const brugerLabel = state?.userLabel ?? "";
  const anvendelse = state?.use ?? "";
  const reservationStart = state?.start ?? null;
  const reservationEnd = state?.end ?? null;
  const editingBookingId = state?.editingBookingId;
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
   * since AvailablePage loaded) and, if still free, inserts the booking —
   * or, when editingBookingId is set (the "Rediger reservation" flow),
   * updates that existing row instead (see
   * supabase/applied/bookings_update_policy.sql for the RLS that allows
   * this). The DB-level exclusion constraint
   * (supabase/booking_overlap_constraint.sql) is the actual race-proof
   * backstop for both — a 23P01 (exclusion_violation) error means this
   * pre-check's race window was lost, and is shown with the same friendly
   * message as the pre-check itself.
   */
  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);

    const { data: existingBookings, error: fetchError } = await supabase
      .from("bookings")
      .select(`${BOOKING_ID_COLUMN}, ${VEHICLE_ID_COLUMN}, start, end`);

    if (fetchError) {
      setError(fetchError.message);
      setIsSubmitting(false);
      return;
    }

    // Excludes the booking being edited (if any) from its own
    // availability check — otherwise re-confirming the same vehicle/time
    // it already occupies would always look unavailable.
    const otherBookings = ((existingBookings ?? []) as BookingWindow[]).filter(
      (b) => b.booking_id !== editingBookingId,
    );

    const stillAvailable = isVehicleAvailable(vehicle.id, otherBookings, reservationStart, reservationEnd);

    if (!stillAvailable) {
      setError("Køretøjet er ikke længere ledigt i den valgte periode.");
      setIsSubmitting(false);
      return;
    }

    // Already resolved on ReservationPage (own afdelingId for a regular
    // admin, the "Kunde/afdeling" pick for a FLEETii admin) and carried
    // through AvailablePage unchanged — this is just a defensive backstop
    // for reaching this page some other way (a raw refresh/bookmark, no
    // router state at all).
    if (!state?.departmentId) {
      setError("Kunne ikke finde afdeling. Start reservationen forfra.");
      setIsSubmitting(false);
      return;
    }

    const bookingFields = {
      [VEHICLE_ID_COLUMN]: vehicle.id,
      start: reservationStart,
      end: reservationEnd,
      usage: anvendelse,
      [USER_ID_COLUMN]: bruger || session?.user.id || null,
      [DEPARTMENT_COLUMN]: state.departmentId,
    };

    const { error: writeError } = editingBookingId
      ? await supabase.from("bookings").update(bookingFields).eq(BOOKING_ID_COLUMN, editingBookingId)
      : await supabase.from("bookings").insert(bookingFields);

    if (writeError) {
      // 23P01 = Postgres exclusion_violation — the DB-level overlap
      // constraint (supabase/booking_overlap_constraint.sql) caught a race
      // the availability pre-check above missed (another booking for the
      // same vehicle/period was inserted in between). Show the same
      // friendly message as the pre-check instead of the raw DB error.
      setError(
        writeError.code === "23P01"
          ? "Køretøjet er ikke længere ledigt i den valgte periode."
          : writeError.message,
      );
      setIsSubmitting(false);
      return;
    }

    navigate(profile?.role === "admin" || profile?.role === "FLEETii admin" ? "/allbookings" : "/bookings", { replace: true });
  };

  /** [label, value] — Start/Slut show "dd/mm" (dropping the year). Kunde/afdeling comes first — a final, read-only "security check" confirming which department this booking is actually about to be written to, before "Bekræft" is pressed. */
  const rows: [string, string][] = [
    ["Kunde/afdeling:", state?.departmentLabel ?? ""],
    ["Reserveret til:", brugerLabel],
    ["Anvendelse:", anvendelse],
    ["Køretøj:", `${vehicle.plate}: ${vehicle.vehicle}`],
    ["Start:", reservationStart ? formatDanishDateTime(reservationStart, true) : ""],
    ["Slut:", reservationEnd ? formatDanishDateTime(reservationEnd, true) : "Ingen slutdato"],
  ];

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
              <h2 className="text-xl font-semibold text-brand-800">
                {editingBookingId ? "Rediger reservation" : "Opret reservation"}
              </h2>

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
                  onClick={() => navigate("/available", { state })}
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
                  {isSubmitting ? "Bekræfter…" : editingBookingId ? "Bekræft ændring" : "Bekræft reservation"}
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
