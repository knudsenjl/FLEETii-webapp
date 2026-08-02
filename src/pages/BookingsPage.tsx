import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";
import { isSettingTilladt } from "../lib/settings";
import {
  BOOKINGS_SELECT_COLUMNS,
  USER_ID_COLUMN,
  formatBookingPeriod,
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
  const { session, profile, afdelingId } = useAuth();
  const navigate = useNavigate();
  const vehicles = use2hireVehicle();
  const user = session?.user.id ?? "";
  const [activeBookings, setActiveBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";
  const departmentBookings = activeBookings.filter((b) => b.departmentId === afdelingId);
  const [nextBooking, ...remainingBookings] = departmentBookings;

  /** Whether afdelingId's department shows Køretøj-ID (vs. plain Reg.nr/number_plate) in the new first column below — see useIdentSettings' own doc comment. Same pattern as AllBookingsPage.tsx/FleetManagementPage.tsx. */
  const { useVehicleIdent } = useIdentSettings(afdelingId);
  /** The genuine Køretøj-ID/Reg.nr pair per listed booking's vehicle, keyed by vehicleId — fetched straight from vehicle_profiles rather than reusing vehicle.plate (see liveVehicleDataSource.ts's toVehicle2Hire), since that field is an UNGATED vehicle_ident-or-number_plate fallback. Same bulk-fetch pattern as AllBookingsPage.tsx's identByVehicleId. */
  const [identByVehicleId, setIdentByVehicleId] = useState<
    Record<string, { vehicleIdent: string | null; numberPlate: string | null }>
  >({});

  useEffect(() => {
    const vehicleIds = Array.from(new Set(departmentBookings.map((b) => b.vehicle)));
    if (vehicleIds.length === 0) {
      setIdentByVehicleId({});
      return;
    }

    let cancelled = false;
    void supabase
      .from("vehicle_profiles")
      .select("vehicle_id, vehicle_ident, number_plate")
      .in("vehicle_id", vehicleIds)
      .returns<{ vehicle_id: string; vehicle_ident: string | null; number_plate: string | null }[]>()
      .then(({ data }) => {
        if (cancelled) return;
        setIdentByVehicleId(
          Object.fromEntries(
            (data ?? []).map((row) => [row.vehicle_id, { vehicleIdent: row.vehicle_ident, numberPlate: row.number_plate }]),
          ),
        );
      });

    return () => {
      cancelled = true;
    };
    // departmentBookings itself is intentionally omitted (fresh array every
    // render) — its content-based vehicleId set (joined below) is what
    // actually determines whether a re-fetch is needed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentBookings.map((b) => b.vehicle).join("|")]);

  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  /** Whether a non-admin user is allowed to create a new reservation, per Tillad_ny_reservation. Admins can always create one regardless (see AllBookingsPage). */
  const [userMayCreateBooking, setUserMayCreateBooking] = useState(false);
  const canShowNewBookingButton = isAdmin || userMayCreateBooking;

  useEffect(() => {
    void isSettingTilladt("Tillad_ny_reservation", profile?.user_id, afdelingId).then(setUserMayCreateBooking);
  }, [profile?.user_id, afdelingId]);

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

    const { data, error: fetchError } = await (isAdmin ? baseQuery : baseQuery.eq(USER_ID_COLUMN, user)).returns<
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
   * below. Not table-fixed: Køretøj-ID/Reg.nr and Periode are both w-px
   * (shrink to their actual content, only meaningful under
   * table-layout:auto — same trick as AllBookingsPage.tsx's own table).
   * Model has neither — combined with `truncate` on its cells (which
   * exempts it from contributing its full intrinsic width to the
   * auto-layout algorithm), it absorbs whatever space the other two leave
   * over.
   */
  const bookingTableHeaderRow = (
    <tr>
      <th className="w-px whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">
        {useVehicleIdent ? "Køretøj" : "Reg.nr"}
      </th>
      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Model</th>
      <th className="w-px whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-center">Periode</th>
    </tr>
  );

  /** Renders one booking row that navigates to BookingDetailsPage on click (or Enter/Space) — used for both the "next" booking and the "other" bookings list. */
  const renderBookingRow = (booking: Booking, isAlternate: boolean, onClick: () => void) => {
    const twoHireVehicle = vehicles.find((v) => v.vehicleId === booking.vehicle);
    const modelLabel = twoHireVehicle ? `${twoHireVehicle.brand} ${twoHireVehicle.model}` : booking.vehicle;
    return (
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
        <td className="w-px whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">
          {useVehicleIdent
            ? identByVehicleId[booking.vehicle]?.vehicleIdent ||
              identByVehicleId[booking.vehicle]?.numberPlate ||
              "—"
            : identByVehicleId[booking.vehicle]?.numberPlate || "—"}
        </td>
        <td className="truncate border-r border-brand-100 px-2 py-0.5 font-medium" title={modelLabel}>
          {modelLabel}
        </td>
        <td className="whitespace-nowrap px-2 py-0.5 text-right" title={formatBookingPeriod(booking)}>
          {formatBookingPeriod(booking, true)}
        </td>
      </tr>
    );
  };

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
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className="bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    {bookingTableHeaderRow}
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {loading && (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-brand-500">Indlæser reservationer…</td>
                      </tr>
                    )}
                    {!loading && error && (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-red-600">{error}</td>
                      </tr>
                    )}
                    {!loading && !error && !nextBooking && (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-brand-500">
                          {canShowNewBookingButton
                            ? "Ingen kommende reservation."
                            : "Anmod administratoren om at lave en reservation til dig."}
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      !error &&
                      nextBooking &&
                      renderBookingRow(nextBooking, false, () =>
                        navigate(`/booking-details/${nextBooking.id}`, { state: { booking: nextBooking } }),
                      )}
                  </tbody>
                </table>
              </div>

              {renderSubheader(
                "Øvrige reservationer",
                "other",
                "Vælg en af disse reservationer for at se detaljer eller aflyse reservationen",
              )}
              <div className="flex min-w-0 min-h-0 flex-col overflow-auto rounded-none border border-brand-100">
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    {bookingTableHeaderRow}
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {loading && (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-brand-500">Indlæser reservationer…</td>
                      </tr>
                    )}
                    {!loading && error && (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-red-600">{error}</td>
                      </tr>
                    )}
                    {!loading && !error && remainingBookings.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-brand-500">Ingen øvrige reservationer.</td>
                      </tr>
                    )}
                    {!loading &&
                      !error &&
                      remainingBookings.map((booking, index) =>
                        renderBookingRow(booking, index % 2 === 1, () =>
                          navigate(`/booking-details/${booking.id}`, { state: { booking } }),
                        ),
                      )}
                  </tbody>
                </table>
              </div>

              {canShowNewBookingButton && (
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => navigate("/reservation")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Opret reservation
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
