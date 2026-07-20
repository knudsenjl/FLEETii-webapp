import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";
import { isSettingTilladt } from "../lib/settings";
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
  departmentId: string | null;
};

/**
 * "My reservations" page ("/bookings"): a regular user's own upcoming
 * bookings, or (for admins) every upcoming booking, split into "next" (the
 * single soonest one) and "other" (everything else) — clicking either
 * navigates straight to BookingDetailsPage (view/cancel a booking from
 * there). See AllBookingsPage for the admin-only cross-department
 * equivalent — the two pages share almost all of this logic but haven't
 * been consolidated.
 */
export function BookingsPage() {
  const { session, profile, afdeling } = useAuth();
  const navigate = useNavigate();
  const vehicles = use2hireVehicle();
  const user = session?.user.email ?? "";
  const [activeBookings, setActiveBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";
  const [myDepartmentId, setMyDepartmentId] = useState<string | null>(null);
  const departmentBookings = activeBookings.filter((b) => b.departmentId === myDepartmentId);
  const [nextBooking, ...remainingBookings] = departmentBookings;

  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  /** Whether a non-admin user is allowed to create a new reservation, per settings.Bruger_ny_reservation. Admins can always create one regardless (see AllBookingsPage). */
  const [userMayCreateBooking, setUserMayCreateBooking] = useState(false);
  const canShowNewBookingButton = isAdmin || userMayCreateBooking;

  useEffect(() => {
    void isSettingTilladt("Bruger_ny_reservation", profile?.user_id, afdeling).then(setUserMayCreateBooking);
  }, [profile?.user_id, afdeling]);

  // Resolves the current user's department NAME (afdeling) to its
  // departments.department_id — bookings are now scoped by that uuid (see
  // supabase/bookings_department_to_department_id.sql), not the name
  // directly, so this is needed to filter activeBookings down to "my
  // department" below.
  useEffect(() => {
    if (!afdeling) {
      setMyDepartmentId(null);
      return;
    }
    void supabase
      .from("departments")
      .select("department_id")
      .eq("name", afdeling)
      .maybeSingle<{ department_id: string }>()
      .then(({ data }) => setMyDepartmentId(data?.department_id ?? null));
  }, [afdeling]);

  /** Fetches every not-yet-ended booking visible to the current user (own bookings, or all department bookings if admin) and replaces `activeBookings`. Called on mount, whenever user/role changes, and again after a cancellation. */
  const loadBookings = async () => {
    if (!isAdmin && !user) {
      setActiveBookings([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const baseQuery = supabase
      .from("bookings")
      .select(BOOKINGS_SELECT_COLUMNS)
      // "end >= now" OR "end is null" — a plain .gte() would silently drop
      // every open-ended booking, since NULL >= x is NULL/falsy in Postgres.
      .or(`end.gte.${nowIsoString()},end.is.null`)
      .order("start", { ascending: true });

    const { data, error: fetchError } = await (isAdmin ? baseQuery : baseQuery.eq("user", user)).returns<
      BookingRow[]
    >();

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setActiveBookings((data ?? []).map(mapBookingRow));
    setLoading(false);
  };

  useEffect(() => {
    void loadBookings();
  }, [user, isAdmin]);

  /**
   * Shared column-header row for both the "next" and "other" booking tables
   * below. Periode gets a fixed width (sized for its longest possible
   * content, the short "dd/mm" two-different-days case) — paired with
   * `table-fixed` on the <table>, this makes Køretøj absorb whatever space
   * is left over instead of a hardcoded cap, so it truncates dynamically
   * depending on how much room Periode's actual content needs.
   */
  const bookingTableHeaderRow = (
    <tr>
      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Køretøj</th>
      <th className="w-44 whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-center">Periode</th>
    </tr>
  );

  /** Renders one booking row that navigates to BookingDetailsPage on click (or Enter/Space) — used for both the "next" booking and the "other" bookings list. */
  const renderBookingRow = (booking: Booking, isAlternate: boolean, onClick: () => void) => (
    <tr
      key={booking.id}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`cursor-pointer transition ${
        isAlternate ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100" : "bg-white text-brand-700 hover:bg-brand-50"
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

  /** A section title with an inline info "?" button that shows `message` via useTimedFlag, keyed so the "next" and "other" sections' popups don't interfere with each other. */
  const renderSubheader = (title: string, key: "next" | "other", message: string) => (
    <div className="relative flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-brand-700">{title}</h3>
      <button
        type="button"
        onClick={() => triggerNotImplemented(key)}
        aria-label="Mere information"
        className="flex h-5 w-5 items-center justify-center rounded-full border border-brand-300 text-[0.65rem] font-bold leading-none text-brand-600 transition hover:bg-brand-50"
      >
        ?
      </button>
      {notImplementedKey === key && (
        <div className="animate-fade-in absolute right-0 top-full z-20 mt-2 w-64 rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs text-brand-700 shadow-lg">
          {message}
        </div>
      )}
    </div>
  );

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
              <h2 className="text-xl font-semibold text-brand-800">
                {profile?.role === "user" ? "Dine reservationer" : "Flådens reservationer"}
              </h2>

              {renderSubheader(
                "Næste reservation",
                "next",
                "Vælg denne reservation for at se detaljer eller aflyse reservationen",
              )}
              <div className="flex min-w-0 min-h-0 flex-col overflow-auto rounded-none border border-brand-100">
                <table className="w-full table-fixed border-collapse text-[0.7rem]">
                  <thead className="bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    {bookingTableHeaderRow}
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
                    {!loading && !error && !nextBooking && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-brand-500">Ingen kommende reservation.</td>
                      </tr>
                    )}
                    {!loading &&
                      !error &&
                      nextBooking &&
                      renderBookingRow(nextBooking, false, () =>
                        navigate("/booking-details", { state: { booking: nextBooking } }),
                      )}
                  </tbody>
                </table>
              </div>

              {renderSubheader(
                "Øvrige reservationer",
                "other",
                "Vælg en af disse reservationer for at se detaljer eller aflyse reservationen",
              )}
              <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-auto rounded-none border border-brand-100">
                <table className="w-full table-fixed border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    {bookingTableHeaderRow}
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
                    {!loading && !error && remainingBookings.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-brand-500">Ingen øvrige reservationer.</td>
                      </tr>
                    )}
                    {!loading &&
                      !error &&
                      remainingBookings.map((booking, index) =>
                        renderBookingRow(booking, index % 2 === 1, () =>
                          navigate("/booking-details", { state: { booking } }),
                        ),
                      )}
                  </tbody>
                </table>
              </div>

              {canShowNewBookingButton && (
                <div className="mt-auto flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => navigate("/reservation")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Ny reservation
                  </button>
                </div>
              )}
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
