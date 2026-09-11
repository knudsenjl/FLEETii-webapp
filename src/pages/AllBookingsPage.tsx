import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isSysadm as isSysadmRole } from "../lib/roles";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useVehicleIdentLookup } from "../hooks/useVehicleIdentLookup";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";
import {
  BOOKINGS_SELECT_COLUMNS,
  formatBookingPeriod,
  formatVehicleIdentLabel,
  formatVehicleLabel,
  mapBookingRow,
  nowIsoString,
  userAnsatId,
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
  userIdent: string | null;
};

/**
 * Admin-only "Aktive reservationer" page ("/allbookings"): every upcoming
 * booking in the admin's department. Clicking a row navigates straight to
 * BookingDetailsPage (view/cancel a booking from there) — this page itself
 * is display/filter-only. This is the admin equivalent of BookingsPage
 * (which shows a regular user their own bookings, or an admin's own "next
 * booking" home view) — the two share most of their fetch/render logic but
 * haven't been consolidated into one component.
 *
 * A sysadm (no department of their own) sees every booking platform-wide by
 * default, narrowed by the global header's Kunde/Afdeling scope (PageHeader's
 * "Data Filter" — see AuthContext's costumerId/afdelingId) exactly like
 * every other admin page now reads it, rather than a page-local Kunde/
 * Afdeling filter of its own. A regular admin never has an unscoped view to
 * begin with — they're always scoped to their own single department. The
 * Bruger/Køretøj filters are also surfaced through that same header popup
 * (see PageHeaderFilterField) rather than a separate funnel popup of this
 * page's own — the state/option lists (departmentUsers/vehicleOptions
 * below) are still entirely this page's own, page-local and non-persisted.
 */
export function AllBookingsPage() {
  const { afdelingId, costumerId, profile } = useAuth();
  /** A sysadm has no department of their own (platform-wide role) — for them alone, the Kunde/Afdeling filters below (not just the existing Bruger/Køretøj ones) actually narrow the list down, since departmentBookings otherwise shows every booking platform-wide. */
  const isSysadm = isSysadmRole(profile?.role);
  const navigate = useNavigate();
  /** Whether afdelingId's department shows "Bruger-ID" (vs. plain "Bruger"/E-mail) in the filter, and combines Køretøj-ID into the "Køretøj" column below ("{ident} / {plate}" — see formatVehicleIdentLabel) rather than swapping to it — see useIdentSettings' own doc comment. Unlike every other gated row in the app, these never fully disappear when off: a booking's user/vehicle is core information, not an optional extra, so they revert to the pre-feature display instead (see the label/value swaps below). */
  const { useUserIdent, useVehicleIdent } = useIdentSettings(afdelingId);
  const vehicles = use2hireVehicle();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  const [users, setUsers] = useState<
    { user_id: string; email: string; user_ident: string | null; department_id: string | null }[]
  >([]);
  /** Page-local, transient (not persisted) — both surfaced inside PageHeader's "Data Filter" popup as Bruger/Køretøj <select> fields rather than a separate funnel popup of this page's own; see PageHeaderFilterField's own doc comment. */
  const [filterUser, setFilterUser] = useState("");
  const [filterVehicle, setFilterVehicle] = useState("");
  /** Every department under the global header's active costumerId (sysadm only) — still needed for scopedDepartmentIds below, to turn a Kunde-only scope (costumerId set, afdelingId null) into a department-id set the client-side booking filter can match against. */
  const [departmentOptions, setDepartmentOptions] = useState<{ department_id: string; name: string }[]>([]);

  /** Loads the departments under the global header's active costumerId (sysadm only) — or every department platform-wide when costumerId is null ("Alle"). A regular admin never has more than their own single department to begin with, so this stays empty for them. */
  useEffect(() => {
    if (!isSysadm) {
      setDepartmentOptions([]);
      return;
    }

    let cancelled = false;
    const query = supabase.from("departments").select("department_id, name").order("name", { ascending: true });
    void (costumerId ? query.eq("costumer_id", costumerId) : query)
      .returns<{ department_id: string; name: string }[]>()
      .then(({ data }) => {
        if (!cancelled) setDepartmentOptions(data ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [isSysadm, costumerId]);

  // A sysadm sees every booking/user platform-wide by default (they
  // have no department of their own to scope to) — the underlying
  // bookings/vehicles/users fetches are already cross-department (SELECT RLS
  // is unrestricted for bookings/vehicle_profiles, and
  // user_profiles_select_allow_fleetii_admin.sql already covers users) — but
  // narrows down to the global header's active Kunde/Afdeling (costumerId/
  // afdelingId), same scope every other admin page now reads. A specific
  // Afdeling always wins over Kunde alone (a department belongs to exactly
  // one costumer, so it's already the more specific choice, and
  // switchDepartment keeps costumerId in lockstep with it anyway); Kunde
  // alone scopes to every one of that costumer's departments
  // (departmentOptions is already loaded pre-scoped to it, see the effect
  // above).
  const scopedDepartmentIds = new Set(departmentOptions.map((d) => d.department_id));
  const departmentBookings = bookings.filter((b) => {
    const bookingDepartmentIds = vehicles.find((v) => v.vehicleId === b.vehicle)?.departmentIds ?? [];
    if (isSysadm) {
      if (afdelingId) return bookingDepartmentIds.includes(afdelingId);
      if (costumerId) return bookingDepartmentIds.some((id) => scopedDepartmentIds.has(id));
      return true;
    }
    return afdelingId !== null && bookingDepartmentIds.includes(afdelingId);
  });
  const vehicleOptions = Array.from(new Set(departmentBookings.map((b) => b.vehicle))).sort();
  const filteredBookings = departmentBookings.filter(
    (b) => (!filterUser || b.userId === filterUser) && (!filterVehicle || b.vehicle === filterVehicle),
  );
  const departmentUsers = isSysadm ? users : users.filter((u) => u.department_id === afdelingId);

  // Re-fetches whenever the active department changes (via PageHeader's
  // "Data Filter") — user_profiles' SELECT RLS
  // (user_profiles_select_admin_own_department) scopes rows to the admin's
  // CURRENT department, so an empty dependency array left this list (and
  // the filter popover's "Bruger" dropdown built from it below) stuck
  // showing whichever department was active on mount — see
  // DepartmentPage.tsx's identical fix.
  useEffect(() => {
    supabase
      .from("user_profiles")
      .select("user_id, email, user_ident, department_id")
      .is("deleted_at", null)
      // A sysadm's own department_id is just their current "Data Filter"
      // scope pointer (see AuthContext's switchDepartment), never a real
      // booking-relevant user — without this, a sysadm who has ever
      // switched their own scope would show up in the Bruger dropdown as
      // if they were a genuine user, same gap as DepartmentPage.tsx's own.
      .neq("role", "sysadm")
      .order("email")
      .then(({ data }) => {
        setUsers(
          (data ?? []).filter(
            (u): u is { user_id: string; email: string; user_ident: string | null; department_id: string | null } =>
              Boolean(u.email),
          ),
        );
      });
  }, [afdelingId]);

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

  /** The genuine Køretøj-ID/Reg.nr (number_plate) pair PLUS blocked-state per listed booking's vehicle, keyed by vehicleId — fetched straight from vehicle_profiles rather than reusing vehicle.plate (see liveVehicleDataSource.ts's toVehicle2Hire), since that field is an UNGATED vehicle_ident-or-number_plate fallback and the new first column below must respect useVehicleIdent. `blocked` (from blocked_at, see VehicleDetailsPage.tsx's "Bloker køretøj") drives the "Blokeret" badge next to that column. */
  const identByVehicleId = useVehicleIdentLookup(bookings.map((b) => b.vehicle));

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
          <PageHeader
            brugerFilter={{
              label: useUserIdent ? "Bruger-ID" : "Bruger",
              value: filterUser,
              onChange: setFilterUser,
              options: departmentUsers.map((u) => ({
                value: u.user_id,
                label: (useUserIdent ? u.user_ident || u.email : u.email) ?? "—",
              })),
            }}
            koretoejFilter={{
              label: "Køretøj",
              value: filterVehicle,
              onChange: setFilterVehicle,
              options: vehicleOptions.map((v) => ({ value: v, label: formatVehicleLabel(v, vehicles) })),
            }}
          />

          <section className="flex min-w-0 min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-w-0 min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold text-brand-800">Aktive reservationer</h2>
                <div className="flex items-center gap-2">
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

              <div className="flex min-w-0 max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
                {/* Not table-fixed: Bruger/Køretøj (or Reg.nr)/Periode are all
                    w-px (shrink to their actual content — only meaningful
                    under table-layout:auto, table-fixed ignores content
                    entirely). Model has none of these — combined with
                    `truncate` (which exempts it from contributing its full
                    intrinsic width to the auto-layout algorithm), it absorbs
                    whatever space the others leave over, same end result as
                    the old table-fixed approach. */}
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <tr>
                      <th className="w-px whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Bruger</th>
                      <th className="w-px whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Køretøj</th>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Model</th>
                      <th className="w-px whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-right">Periode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {loading && (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-brand-500">Indlæser reservationer…</td>
                      </tr>
                    )}
                    {!loading && error && (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-red-600">{error}</td>
                      </tr>
                    )}
                    {!loading && !error && filteredBookings.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-brand-500">
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
                        const goToBooking = () => navigate(`/booking-details/${booking.id}`, { state: { booking } });
                        const twoHireVehicle = vehicles.find((v) => v.vehicleId === booking.vehicle);
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
                              className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5"
                              title={(useUserIdent ? userAnsatId(booking) : booking.userEmail) ?? undefined}
                            >
                              {(useUserIdent ? userAnsatId(booking) : booking.userEmail) ?? "—"}
                            </td>
                            <td className="w-px whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">
                              {formatVehicleIdentLabel(
                                identByVehicleId[booking.vehicle]?.vehicleIdent,
                                identByVehicleId[booking.vehicle]?.numberPlate,
                                useVehicleIdent,
                              )}
                              {identByVehicleId[booking.vehicle]?.blocked && (
                                <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-red-700">
                                  Blokeret
                                </span>
                              )}
                            </td>
                            <td
                              className="truncate border-r border-brand-100 px-2 py-0.5 font-medium"
                              title={twoHireVehicle ? `${twoHireVehicle.brand} ${twoHireVehicle.model}` : booking.vehicle}
                            >
                              {twoHireVehicle ? `${twoHireVehicle.brand} ${twoHireVehicle.model}` : booking.vehicle}
                            </td>
                            <td className="whitespace-nowrap px-2 py-0.5 text-right">{formatBookingPeriod(booking, true)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/reservation")}
                  className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Opret reservation
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
