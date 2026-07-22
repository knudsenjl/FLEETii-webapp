import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";
import {
  BOOKINGS_SELECT_COLUMNS,
  formatBookingPeriod,
  formatVehicleLabel,
  mapBookingRow,
  nowIsoString,
  type BookingRow,
} from "../lib/bookings";

/** A booking as rendered on this page (see MappedBooking in lib/bookings.ts, which this mirrors). */
type Booking = {
  id: string;
  vehicle: string;
  startDate: string;
  start: string;
  endDate: string | null;
  end: string | null;
  use: string;
  userId: string | null;
  userEmail: string | null;
};

/**
 * Admin-only "Aktive reservationer" page ("/allbookings"): every upcoming
 * booking in the admin's department, with a user/vehicle filter popover.
 * Clicking a row navigates straight to BookingDetailsPage (view/cancel a
 * booking from there) — this page itself is display/filter-only. This is
 * the admin equivalent of BookingsPage (which shows a regular user their
 * own bookings, or an admin's own "next booking" home view) — the two share
 * most of their fetch/render logic but haven't been consolidated into one
 * component.
 */
export function AllBookingsPage() {
  const { afdelingId } = useAuth();
  const navigate = useNavigate();
  const vehicles = use2hireVehicle();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  const [users, setUsers] = useState<{ user_id: string; email: string; department_id: string | null }[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterUser, setFilterUser] = useState("");
  const [filterVehicle, setFilterVehicle] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filterOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  const departmentBookings = bookings.filter(
    (b) => afdelingId !== null && vehicles.find((v) => v.vehicleId === b.vehicle)?.departmentIds.includes(afdelingId),
  );
  const vehicleOptions = Array.from(new Set(departmentBookings.map((b) => b.vehicle))).sort();
  const filteredBookings = departmentBookings.filter(
    (b) => (!filterUser || b.userId === filterUser) && (!filterVehicle || b.vehicle === filterVehicle),
  );
  const departmentUsers = users.filter((u) => u.department_id === afdelingId);

  useEffect(() => {
    supabase
      .from("user_profiles")
      .select("user_id, email, department_id")
      .order("email")
      .then(({ data }) => {
        setUsers(
          (data ?? []).filter(
            (u): u is { user_id: string; email: string; department_id: string | null } => Boolean(u.email),
          ),
        );
      });
  }, []);

  /** Fetches every not-yet-ended booking (across all departments — filtered client-side to the admin's own department below) and replaces `bookings`. Called on mount. */
  const loadBookings = async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("bookings")
      .select(BOOKINGS_SELECT_COLUMNS)
      // "end >= now" OR "end is null" — a plain .gte() would silently drop
      // every open-ended booking, since NULL >= x is NULL/falsy in Postgres.
      .or(`end.gte.${nowIsoString()},end.is.null`)
      .order("start", { ascending: true })
      .returns<BookingRow[]>();

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setBookings((data ?? []).map(mapBookingRow));
    setLoading(false);
  };

  useEffect(() => {
    void loadBookings();
  }, []);

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
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold text-brand-800">Aktive reservationer</h2>
                <div className="flex items-center gap-2">
                  <div className="relative" ref={filterRef}>
                    <button
                      type="button"
                      onClick={() => setFilterOpen((prev) => !prev)}
                      aria-label="Filtrer"
                      className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                        filterUser || filterVehicle
                          ? "border-red-500 bg-red-50 text-red-600 hover:bg-red-100"
                          : "border-brand-300 text-brand-600 hover:bg-brand-50"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                        <polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4" />
                      </svg>
                    </button>
                    <InlinePopup
                      visible={filterOpen}
                      align="right"
                      message={
                        <>
                          <p className="mb-2">Du kan her udvælge reservationer på disse kriterier:</p>
                          <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                            Bruger
                            <select
                              value={filterUser}
                              onChange={(e) => setFilterUser(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                            >
                              <option value="">Alle</option>
                              {departmentUsers.map((u) => (
                                <option key={u.user_id} value={u.user_id}>
                                  {u.email}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-[0.7rem] font-medium text-brand-700">
                            Køretøj
                            <select
                              value={filterVehicle}
                              onChange={(e) => setFilterVehicle(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                            >
                              <option value="">Alle</option>
                              {vehicleOptions.map((v) => (
                                <option key={v} value={v}>
                                  {formatVehicleLabel(v, vehicles)}
                                </option>
                              ))}
                            </select>
                          </label>
                          {(filterUser || filterVehicle) && (
                            <button
                              type="button"
                              onClick={() => {
                                setFilterUser("");
                                setFilterVehicle("");
                              }}
                              className="mt-2 text-[0.7rem] font-medium text-accent-600 hover:underline"
                            >
                              Nulstil filter
                            </button>
                          )}
                        </>
                      }
                    />
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => triggerNotImplemented("info")}
                      aria-label="Mere information"
                      className="flex h-5 w-5 items-center justify-center rounded-full border border-brand-300 text-[0.65rem] font-bold leading-none text-brand-600 transition hover:bg-brand-50"
                    >
                      ?
                    </button>
                    <InlinePopup
                      visible={notImplementedKey === "info"}
                      message="Vælg en af disse reservationer for at kunne se detaljer, rette reservationen, eller aflyse reservationen"
                      align="right"
                    />
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-auto rounded-none border border-brand-100">
                {/* table-fixed + a fixed Periode width, so Køretøj absorbs
                    whatever space is left over instead of a hardcoded cap —
                    see BookingsPage for the same pattern. */}
                <table className="w-full table-fixed border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <tr>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Køretøj</th>
                      <th className="w-44 whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-center">Periode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {loading && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-brand-500">Indlæser reservationer…</td>
                      </tr>
                    )}
                    {!loading && error && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-red-600">{error}</td>
                      </tr>
                    )}
                    {!loading && !error && filteredBookings.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-brand-500">
                          {filterUser || filterVehicle
                            ? "Ingen reservationer matcher filteret."
                            : "Ingen aktive reservationer."}
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      !error &&
                      filteredBookings.map((booking, index) => {
                        const isAlternate = index % 2 === 1;
                        const goToBooking = () => navigate("/booking-details", { state: { booking } });
                        return (
                          <tr
                            key={booking.id}
                            role="button"
                            tabIndex={0}
                            onClick={goToBooking}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                goToBooking();
                              }
                            }}
                            className={`cursor-pointer transition ${
                              isAlternate
                                ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                                : "bg-white text-brand-700 hover:bg-brand-50"
                            }`}
                          >
                            <td
                              className="truncate border-r border-brand-100 px-2 py-0.5 font-medium"
                              title={formatVehicleLabel(booking.vehicle, vehicles)}
                            >
                              {formatVehicleLabel(booking.vehicle, vehicles)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-0.5 text-right" title={formatBookingPeriod(booking)}>
                              {formatBookingPeriod(booking, true)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div className="mt-auto flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/reservation")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Ny reservation
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
