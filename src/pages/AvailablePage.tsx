import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isSysadm } from "../lib/roles";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useVehicleIdentLookup } from "../hooks/useVehicleIdentLookup";
import { supabase } from "../lib/supabase";
import {
  BOOKING_ID_COLUMN,
  VEHICLE_ID_COLUMN,
  computeFreePeriod,
  formatFreePeriod,
  formatVehicleIdentLabel,
  isVehicleAvailable,
  nowIsoString,
  type BookingWindow,
} from "../lib/bookings";

/** A vehicle available for the requested period, plus a human-readable description of its free window (short "dd/mm" dates). */
type AvailableVehicle = {
  id: string;
  vehicle: string;
  plate: string;
  ledigPeriode: string;
};

function formatDanishTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

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
 * either side. Selecting one and pressing "Reserver"/"Opdater" continues to
 * ConfirmPage — still no DB write at this point. When editing (editingBookingId
 * set), a "Fortryd" button sits alongside "Opdater" — no DB changes, just
 * back to the booking's own detail page, same as ReservationPage's own
 * "Fortryd".
 *
 * targetDepartmentId is what actually scopes availableVehicles — afdelingId
 * directly for a regular admin, or state.departmentId (ReservationPage's own
 * "Kunde/afdeling" pick) for a sysadm, who has no afdelingId of their
 * own. Carried through to ConfirmPage unchanged, which writes it as the
 * booking's department_id.
 */
export function AvailablePage() {
  const { afdelingId, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as
    | {
        user?: string;
        userLabel?: string;
        use?: string;
        start?: string;
        end?: string;
        editingBookingId?: string;
        editingVehicleId?: string;
        /** The RESOLVED target department from ReservationPage — the sysadm-only "Kunde/afdeling" pick, or just afdelingId unchanged for every other role (see ReservationPage's own doc comment). Scopes availableVehicles below, and is carried through unchanged to ConfirmPage, which writes it as the booking's department_id. */
        departmentId?: string | null;
        /** Display-ready counterpart to departmentId — ConfirmPage's read-only "Kunde/afdeling" summary row. Purely pass-through here, same as userLabel. */
        departmentLabel?: string;
        /** Present only when this page was reached via a browser back-navigation from ConfirmPage — see the "Reserver"/"Opdater" button's own comment below. Restores the row the admin had picked, which a plain useState initializer would otherwise lose on remount. */
        selectedVehicleId?: string | null;
      }
    | null;
  const bruger = state?.user ?? "";
  const brugerLabel = state?.userLabel ?? "";
  const anvendelse = state?.use ?? "";
  const editingBookingId = state?.editingBookingId;
  const reservationStart = state?.start ? new Date(state.start) : null;
  const reservationEnd = state?.end ? new Date(state.end) : null;
  /** For a sysadm, state.departmentId (ReservationPage's own "Kunde/afdeling" pick) is authoritative — they have no afdelingId of their own. Every other role keeps using afdelingId directly, unchanged. */
  const targetDepartmentId = isSysadm(profile?.role) ? (state?.departmentId ?? null) : afdelingId;

  const [bookings, setBookings] = useState<BookingWindow[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [bookingsError, setBookingsError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("bookings")
      .select(`${BOOKING_ID_COLUMN}, ${VEHICLE_ID_COLUMN}, start, end`)
      .then(({ data, error }) => {
        if (error) {
          setBookingsError(error.message);
          setLoadingBookings(false);
          return;
        }
        // Excludes the booking being edited (if any) from its own
        // availability/free-period check — otherwise a "Rediger
        // reservation" flow would always see its own current vehicle/time
        // slot as occupied, since the row hasn't been updated yet.
        const rows = (data ?? []) as BookingWindow[];
        setBookings(editingBookingId ? rows.filter((b) => b.booking_id !== editingBookingId) : rows);
        setLoadingBookings(false);
      });
  }, [editingBookingId]);

  const referenceStart = state?.start ?? nowIsoString();
  const referenceEnd = state?.end ?? nowIsoString();

  const twoHireVehicles = use2hireVehicle();
  const availableVehicles: AvailableVehicle[] = twoHireVehicles
    // The booking being edited's own current vehicle bypasses the
    // department filter — it needs to stay selectable/visible here even if
    // it isn't in the editing admin's own department (e.g. the booking was
    // originally made under a different department context), otherwise
    // "Rediger reservation" can never keep (or even see) that vehicle. It's
    // still fully subject to the real availability check right below: if
    // the (possibly just-edited) period now genuinely conflicts with a
    // different booking, it correctly won't show, same as any other
    // vehicle.
    .filter(
      (v) =>
        (targetDepartmentId !== null && v.departmentIds.includes(targetDepartmentId)) ||
        v.vehicleId === state?.editingVehicleId,
    )
    .filter((v) => isVehicleAvailable(v.vehicleId, bookings, state?.start ?? null, state?.end ?? null))
    .map((v) => {
      const freePeriod = computeFreePeriod(v.vehicleId, bookings, referenceStart, referenceEnd);
      return {
        id: v.vehicleId,
        vehicle: `${v.brand} ${v.model}`,
        plate: v.plate,
        ledigPeriode: freePeriod === null ? "Ingen bookinger" : formatFreePeriod(freePeriod, true),
      };
    });

  /** Whether afdelingId's department shows Køretøj-ID (vs. plain Reg.nr/number_plate) in the new first column below — see useIdentSettings' own doc comment. Same pattern as AllBookingsPage.tsx/BookingsPage.tsx. */
  const { useVehicleIdent } = useIdentSettings(afdelingId);
  /** The genuine Køretøj-ID/Reg.nr pair per listed vehicle, keyed by vehicleId — fetched straight from vehicle_profiles rather than reusing vehicle.plate (see liveVehicleDataSource.ts's toVehicle2Hire), since that field is an UNGATED vehicle_ident-or-number_plate fallback. */
  const identByVehicleId = useVehicleIdentLookup(availableVehicles.map((v) => v.id));

  /** Pre-selects the vehicle the booking being edited already had (see ReservationPage's "editing.vehicleId") — that vehicle bypasses the department filter above, and its own booking row is excluded from the conflict check, so it's guaranteed to show up as available here for its original period. state?.selectedVehicleId (present only after a browser back-navigation from ConfirmPage — see the "Reserver"/"Opdater" button below) wins over that, so a real pick the admin already made isn't silently replaced by the editing-default. Still just a plain initial value otherwise: the user can pick a different vehicle same as any other row. */
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    state?.selectedVehicleId ?? state?.editingVehicleId ?? null,
  );
  const selectedVehicle = availableVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
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
                  <span className="text-[0.7rem] text-brand-600">
                    Periode: {formatDanishDateTimeShort(reservationStart)} -{" "}
                    {isSameDate(reservationStart, reservationEnd)
                      ? formatDanishTime(reservationEnd)
                      : formatDanishDateTimeShort(reservationEnd)}
                  </span>
                )}
              </div>

              <div className="flex min-w-0 min-h-0 flex-col overflow-auto rounded-none border border-brand-100">
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <tr>
                      <th className="w-px whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Køretøj</th>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Model</th>
                      <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-center">Ledig periode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {loadingBookings && (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-brand-500">Henter ledige køretøjer…</td>
                      </tr>
                    )}
                    {!loadingBookings && bookingsError && (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-red-600">{bookingsError}</td>
                      </tr>
                    )}
                    {!loadingBookings && !bookingsError && availableVehicles.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-brand-500">Ingen ledige køretøjer.</td>
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
                            <td className="w-px whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">
                              {formatVehicleIdentLabel(
                                identByVehicleId[vehicle.id]?.vehicleIdent,
                                identByVehicleId[vehicle.id]?.numberPlate,
                                useVehicleIdent,
                              )}
                            </td>
                            <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">{vehicle.vehicle}</td>
                            <td className="whitespace-nowrap px-2 py-0.5 text-center">{vehicle.ledigPeriode}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div className={editingBookingId ? "grid grid-cols-2 gap-3 pt-2" : "flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end"}>
                {editingBookingId && (
                  <button
                    type="button"
                    onClick={() => navigate(`/booking-details/${editingBookingId}`)}
                    className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Fortryd
                  </button>
                )}
                <button
                  type="button"
                  disabled={!selectedVehicle}
                  onClick={() => {
                    if (!selectedVehicle) return;
                    // Snapshot the picked vehicle onto THIS page's own
                    // history entry (replace, not push) right before
                    // navigating away — same fix as ReservationPage's
                    // formSnapshot, so a browser back-navigation from
                    // ConfirmPage doesn't lose the selection.
                    navigate(location.pathname, { replace: true, state: { ...state, selectedVehicleId } });
                    navigate("/confirm", {
                      state: {
                        vehicle: selectedVehicle,
                        user: bruger,
                        userLabel: brugerLabel,
                        use: anvendelse,
                        start: state?.start,
                        end: state?.end,
                        editingBookingId,
                        departmentId: targetDepartmentId,
                        departmentLabel: state?.departmentLabel,
                      },
                    });
                  }}
                  className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {editingBookingId ? "Opdater" : "Reserver"}
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
