import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { CarGlyph } from "../components/CarGlyph";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { supabase } from "../lib/supabase";
import { isSettingTilladt } from "../lib/settings";
import {
  BOOKINGS_SELECT_COLUMNS,
  USER_ID_COLUMN,
  formatBookingPeriod,
  formatVehicleIdentLabel,
  isoPrefix,
  mapBookingRow,
  nowIsoString,
  type BookingRow,
} from "../lib/bookings";

/** A booking as rendered on this page (see MappedBooking in lib/bookings.ts, which this mirrors). startIso/endIso are kept (unlike the original table-only version of this type) to drive the "Aktiv nu" badge below via real wall-clock comparisons — see isoPrefix's own doc comment for why that's isoPrefix/string comparison, never `new Date(...)`. */
type Booking = {
  id: string;
  vehicle: string;
  startDate: string;
  start: string;
  endDate: string | null;
  end: string | null;
  startIso: string;
  endIso: string | null;
  use: string;
  userId: string | null;
  userEmail: string | null;
  departmentId: string | null;
};

/**
 * "My reservations" page ("/bookings", route-gated to role "user" via
 * requireRole — see App.tsx): a mobile-first card list of the viewer's own
 * upcoming bookings, ordered soonest-first — tapping a card navigates
 * straight to BookingDetailsPage (view/cancel a booking from there); a
 * teal "Aktiv nu" badge marks whichever one is currently in progress (see
 * isBookingActive below). Role "user" also has a dedicated landing page for
 * just their own current/next booking (BookingPage.tsx, "/booking") — this
 * page is the full list reached from there via its "Alle" button, not a
 * replacement for it. AllBookingsPage is the separate admin-only
 * cross-department equivalent (still the original table layout) —
 * admin/FLEETii admin are routed there instead (see ConfirmPage.tsx), never
 * here, so this page no longer needs its own admin branch.
 */
export function BookingsPage() {
  const { session, profile, afdelingId } = useAuth();
  const navigate = useNavigate();
  const vehicles = use2hireVehicle();
  const user = session?.user.id ?? "";
  const [activeBookings, setActiveBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const departmentBookings = activeBookings.filter((b) => b.departmentId === afdelingId);

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

  /** Whether the viewer is allowed to create a new reservation, per Tillad_ny_reservation (admins always can, but they use AllBookingsPage instead — see this page's own doc comment). */
  const [userMayCreateBooking, setUserMayCreateBooking] = useState(false);
  const canShowNewBookingButton = userMayCreateBooking;

  useEffect(() => {
    void isSettingTilladt("Tillad_ny_reservation", profile?.user_id, afdelingId).then(setUserMayCreateBooking);
  }, [profile?.user_id, afdelingId]);

  /** Fetches every not-yet-ended booking belonging to the viewer and replaces `activeBookings`. Called on mount, whenever the user changes, and again after a cancellation. */
  const loadBookings = async () => {
    if (!user) {
      setActiveBookings([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("bookings")
      .select(BOOKINGS_SELECT_COLUMNS)
      // "end >= now" OR "end is null" — a plain .gte() would silently drop
      // every open-ended booking, since NULL >= x is NULL/falsy in Postgres.
      .or(`end.gte.${nowIsoString()},end.is.null`)
      .eq(USER_ID_COLUMN, user)
      .order("start", { ascending: true })
      .returns<BookingRow[]>();

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
  }, [user]);

  /** Whether `booking` is the viewer's currently-active reservation (start <= now <= end, or end is null) — drives the "Aktiv nu" badge below. Same wall-clock isoPrefix comparison convention as BookingPage.tsx's own bookingStarted/bookingExpired (see isoPrefix's doc comment for why never `new Date(...)`). */
  const isBookingActive = (booking: Booking) => {
    const nowPrefix = isoPrefix(nowIsoString());
    const started = nowPrefix >= isoPrefix(booking.startIso);
    const expired = booking.endIso !== null && nowPrefix >= isoPrefix(booking.endIso);
    return started && !expired;
  };

  /** Renders one reservation as a tappable card (native <button>, so Enter/Space activation is free) navigating to BookingDetailsPage on click. */
  const renderBookingCard = (booking: Booking, onClick: () => void) => {
    const twoHireVehicle = vehicles.find((v) => v.vehicleId === booking.vehicle);
    const modelLabel = twoHireVehicle ? `${twoHireVehicle.brand} ${twoHireVehicle.model}` : booking.vehicle;
    const identLabel = formatVehicleIdentLabel(
      identByVehicleId[booking.vehicle]?.vehicleIdent,
      identByVehicleId[booking.vehicle]?.numberPlate,
      useVehicleIdent,
    );
    return (
      <button
        key={booking.id}
        type="button"
        onClick={onClick}
        className="flex items-center gap-3 rounded-[20px] border border-brand-100 bg-white p-3.5 text-left shadow-sm shadow-brand-900/5 transition hover:bg-brand-50"
      >
        <CarGlyph className="h-6 w-10 shrink-0 text-brand-600" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-brand-800">{modelLabel}</span>
            {isBookingActive(booking) && (
              <span className="shrink-0 rounded-full bg-accent-100 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-accent-700">
                Aktiv nu
              </span>
            )}
          </div>
          <span className="truncate text-xs text-brand-500">{identLabel}</span>
          <span className="truncate text-xs text-brand-700">{formatBookingPeriod(booking, true)}</span>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-brand-300">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
    );
  };

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 text-brand-900">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-4 pt-4"
      >
        <PageHeader compact />

        <h2 className="shrink-0 pb-1 text-xl font-semibold text-brand-800">Dine reservationer</h2>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-4">
          {loading && <p className="py-3 text-center text-sm text-brand-500">Indlæser reservationer…</p>}
          {!loading && error && <p className="py-3 text-center text-sm text-red-600">{error}</p>}
          {!loading && !error && departmentBookings.length === 0 && (
            <p className="py-3 text-center text-sm text-brand-500">
              {canShowNewBookingButton ? "Ingen kommende reservation." : "Anmod administratoren om at lave en reservation til dig."}
            </p>
          )}
          {!loading &&
            !error &&
            departmentBookings.map((booking) =>
              renderBookingCard(booking, () => navigate(`/booking-details/${booking.id}`, { state: { booking } })),
            )}
        </div>

        {canShowNewBookingButton && (
          <div className="shrink-0 border-t border-brand-100 pb-5 pt-3">
            <button
              type="button"
              onClick={() => navigate("/reservation")}
              className="w-full rounded-full border border-brand-200 bg-white px-2 py-2.5 text-sm font-semibold text-brand-800 transition hover:bg-brand-50"
            >
              Opret reservation
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
