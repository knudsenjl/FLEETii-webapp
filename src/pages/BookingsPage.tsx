import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { InlinePopup } from "../components/InlinePopup";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";
import {
  BOOKINGS_SELECT_COLUMNS,
  BOOKING_ID_COLUMN,
  formatVehicleLabel,
  mapBookingRow,
  type BookingRow,
} from "../lib/bookings";

type Booking = {
  id: number;
  vehicle: string;
  startDate: string;
  start: string;
  endDate: string;
  end: string;
  use: string;
  department: string | null;
};

export function BookingsPage() {
  const { signOut, session, profile, afdeling } = useAuth();
  const navigate = useNavigate();
  const vehicles = use2hireVehicle();
  const user = session?.user.email ?? "";
  const [activeBookings, setActiveBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";
  const departmentBookings = activeBookings.filter((b) => b.department === afdeling);
  const [nextBooking, ...remainingBookings] = departmentBookings;

  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const selectedBooking = remainingBookings.find((b) => b.id === selectedBookingId) ?? null;
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [pendingCancel, setPendingCancel] = useState<Booking | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  const [infoPopup, setInfoPopup] = useState<"next" | "other" | null>(null);
  const infoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (infoTimeoutRef.current) clearTimeout(infoTimeoutRef.current);
    };
  }, []);

  const showInfo = (key: "next" | "other") => {
    if (infoTimeoutRef.current) clearTimeout(infoTimeoutRef.current);
    setInfoPopup(key);
    infoTimeoutRef.current = setTimeout(() => setInfoPopup(null), 3000);
  };

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
      .from("Bookings")
      .select(BOOKINGS_SELECT_COLUMNS)
      .gte("end", new Date().toISOString())
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

  const handleCancel = async (booking: Booking) => {
    setCancelError(null);
    setCancellingId(booking.id);
    const { error: deleteError } = await supabase.from("Bookings").delete().eq(BOOKING_ID_COLUMN, booking.id);
    setCancellingId(null);

    if (deleteError) {
      setCancelError(deleteError.message);
      return;
    }

    setPendingCancel(null);
    if (selectedBookingId === booking.id) setSelectedBookingId(null);
    await loadBookings();
  };

  const bookingTableHeaderRow = (
    <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem] bg-brand-50 px-1 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
      <div className="truncate border-r border-brand-200 pr-1">Køretøj</div>
      <div className="whitespace-nowrap border-r border-brand-200 px-1 text-center">Start</div>
      <div className="whitespace-nowrap px-1 text-center">Slut</div>
    </div>
  );

  const renderBookingRow = (
    booking: Booking,
    isAlternate: boolean,
    options?: { isSelected?: boolean; onClick?: () => void },
  ) => {
    const interactive = Boolean(options?.onClick);
    const rowClassName = `grid w-full grid-cols-[minmax(0,1fr)_7.5rem_7.5rem] px-1 py-0.5 text-left text-[0.7rem] transition ${
      options?.isSelected
        ? "bg-accent-50 text-brand-800 ring-1 ring-inset ring-accent-500"
        : isAlternate
          ? `bg-brand-50/70 text-brand-700 ${interactive ? "hover:bg-brand-100" : ""}`
          : `bg-white text-brand-700 ${interactive ? "hover:bg-brand-50" : ""}`
    }`;
    const rowContent = (
      <>
        <div className="truncate border-r border-brand-100 pr-1 font-medium">{formatVehicleLabel(booking.vehicle, vehicles)}</div>
        <div className="whitespace-nowrap border-r border-brand-100 px-1 text-right">{`${booking.startDate} ${booking.start}`}</div>
        <div className="whitespace-nowrap px-1 text-right">{`${booking.endDate} ${booking.end}`}</div>
      </>
    );

    if (!options?.onClick) {
      return (
        <div key={booking.id} className={rowClassName}>
          {rowContent}
        </div>
      );
    }

    return (
      <button key={booking.id} type="button" onClick={options.onClick} className={rowClassName}>
        {rowContent}
      </button>
    );
  };

  const renderSubheader = (title: string, key: "next" | "other", message: string) => (
    <div className="relative flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-brand-700">{title}</h3>
      <button
        type="button"
        onClick={() => showInfo(key)}
        aria-label="Mere information"
        className="flex h-5 w-5 items-center justify-center rounded-full border border-brand-300 text-[0.65rem] font-bold leading-none text-brand-600 transition hover:bg-brand-50"
      >
        ?
      </button>
      {infoPopup === key && (
        <div className="animate-fade-in absolute right-0 top-full z-10 mt-2 w-64 rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs text-brand-700 shadow-lg">
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
              <h2 className="text-xl font-semibold text-brand-800">
                {profile?.role === "user" ? "Dine reservationer" : "Flådens reservationer"}
              </h2>

              {renderSubheader(
                "Næste reservation",
                "next",
                "Du kan først låse bilen, eller låse den op 5 min. før/efter reservationsperioden",
              )}
              <div className="flex flex-col overflow-hidden rounded-none border border-brand-100">
                {bookingTableHeaderRow}
                <div className="divide-y divide-brand-100 bg-white">
                  {loading && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Indlæser reservationer…</div>
                  )}
                  {!loading && error && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-red-600">{error}</div>
                  )}
                  {!loading && !error && !nextBooking && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Ingen kommende reservation.</div>
                  )}
                  {!loading && !error && nextBooking && renderBookingRow(nextBooking, false)}
                </div>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <button
                    type="button"
                    disabled={!nextBooking}
                    onClick={() => triggerNotImplemented("laas-op-next")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Lås op
                  </button>
                  <InlinePopup visible={notImplementedKey === "laas-op-next"} message="Endnu ikke implementeret" />
                </div>
                <div className="relative flex-1">
                  <button
                    type="button"
                    disabled={!nextBooking}
                    onClick={() => triggerNotImplemented("laas-next")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Lås
                  </button>
                  <InlinePopup visible={notImplementedKey === "laas-next"} message="Endnu ikke implementeret" />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!nextBooking}
                  onClick={() => nextBooking && navigate("/bookingDetails", { state: { booking: nextBooking } })}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Vis reservation
                </button>
                <button
                  type="button"
                  disabled={!nextBooking}
                  onClick={() => nextBooking && setPendingCancel(nextBooking)}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Slet reservation
                </button>
              </div>

              {renderSubheader(
                "Øvrige reservationer",
                "other",
                "Vælg en af disse reservationer for at kunne se detaljer, rette reservationen, eller aflyse reservationen",
              )}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border border-brand-100">
                {bookingTableHeaderRow}

                <div className="min-h-0 flex-1 divide-y divide-brand-100 overflow-y-auto bg-white">
                  {loading && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Indlæser reservationer…</div>
                  )}
                  {!loading && error && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-red-600">{error}</div>
                  )}
                  {!loading && !error && remainingBookings.length === 0 && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Ingen øvrige reservationer.</div>
                  )}
                  {!loading &&
                    !error &&
                    remainingBookings.map((booking, index) =>
                      renderBookingRow(booking, index % 2 === 1, {
                        isSelected: booking.id === selectedBookingId,
                        onClick: () =>
                          setSelectedBookingId((current) => (current === booking.id ? null : booking.id)),
                      }),
                    )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!selectedBooking}
                  onClick={() =>
                    selectedBooking && navigate("/bookingDetails", { state: { booking: selectedBooking } })
                  }
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Vis reservation
                </button>
                <button
                  type="button"
                  disabled={!selectedBooking}
                  onClick={() => selectedBooking && setPendingCancel(selectedBooking)}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Slet reservation
                </button>
              </div>

              <div className="mt-auto flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/reservation")}
                  className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Ny reservation
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>

      {pendingCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <p className="text-sm font-medium text-brand-800">
              Er du sikker på, at du vil aflyse denne reservation?
            </p>
            {cancelError && <p className="mt-2 text-sm text-red-600">{cancelError}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPendingCancel(null)}
                disabled={cancellingId === pendingCancel.id}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Nej
              </button>
              <button
                type="button"
                onClick={() => void handleCancel(pendingCancel)}
                disabled={cancellingId === pendingCancel.id}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancellingId === pendingCancel.id ? "Aflyser…" : "Ja"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
