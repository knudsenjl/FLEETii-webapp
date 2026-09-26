import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isAnyAdmin } from "../lib/roles";
import { PageHeader } from "../components/PageHeader";
import { PageShell } from "../components/PageShell";
import { Button } from "../components/Button";
import { PageSection } from "../components/PageSection";
import { PageSectionBody } from "../components/PageSectionBody";
import { SectionHeading } from "../components/SectionHeading";
import { supabase } from "../lib/supabase";
import {
  BOOKING_ID_COLUMN,
  DEPARTMENT_COLUMN,
  USER_ID_COLUMN,
  VEHICLE_ID_COLUMN,
  isVehicleAvailable,
  type BookingWindow,
} from "../lib/bookings";
import { fetchVehicleConflictWindows } from "../lib/bookingWindows";
import { formatDanishDateTimeShort, nowUtcIso } from "../lib/time";
import type { DropInGuest } from "../lib/dropIn";
import { callFunction } from "../lib/callFunction";

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
 * regular admin it's just their own afdelingId; for a sysadm (no
 * afdelingId of their own) it's whatever they chose in ReservationPage's
 * own "Kunde/afdeling" row. This page has no department picker of its own —
 * it just writes whatever arrives here as the booking's department_id.
 * departmentLabel (its display-ready counterpart) is shown as the summary's
 * very first row, a final read-only "security check" so whoever's
 * confirming can double-check the department before "Bekræft" actually
 * writes it — most useful for a sysadm picking among many, but shown
 * for every role.
 *
 * Drop-in mode (router state `dropInGuest`, see ReservationPage's doc
 * comment): the summary also shows the guest's details, and "Bekræft"
 * doesn't insert the booking itself — create-drop-in-booking.mts does the
 * booking (still under this admin's own RLS), the guest row and the guest's
 * email in one call. Lands on the new booking's details page afterwards.
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
        dropInGuest?: DropInGuest;
        /** Editing a drop-in booking (see ReservationPage's dropInBrugerLabel): user_id must stay NULL — bookings_guest_has_no_user would reject anything else. */
        editingIsGuest?: boolean;
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
  /** Only for a NEW drop-in — see this component's doc comment. */
  const dropInGuest = editingBookingId ? undefined : state?.dropInGuest;
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

    // Only this vehicle's bookings that could overlap, read in full (see
    // lib/bookingWindows.ts — the old unfiltered select of every booking
    // was silently capped at 1000 rows).
    let existingBookings: BookingWindow[];
    try {
      existingBookings = await fetchVehicleConflictWindows(vehicle.id, reservationStart ?? nowUtcIso());
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Kunne ikke kontrollere ledigheden.");
      setIsSubmitting(false);
      return;
    }

    // Excludes the booking being edited (if any) from its own
    // availability check — otherwise re-confirming the same vehicle/time
    // it already occupies would always look unavailable.
    const otherBookings = existingBookings.filter(
      (b) => b.booking_id !== editingBookingId,
    );

    const stillAvailable = isVehicleAvailable(vehicle.id, otherBookings, reservationStart, reservationEnd);

    if (!stillAvailable) {
      setError("Køretøjet er ikke længere ledigt i den valgte periode.");
      setIsSubmitting(false);
      return;
    }

    // Already resolved on ReservationPage (own afdelingId for a regular
    // admin, the "Kunde/afdeling" pick for a sysadm) and carried
    // through AvailablePage unchanged — this is just a defensive backstop
    // for reaching this page some other way (a raw refresh/bookmark, no
    // router state at all).
    if (!state?.departmentId) {
      setError("Kunne ikke finde afdeling. Start reservationen forfra.");
      setIsSubmitting(false);
      return;
    }

    if (dropInGuest) {
      await confirmDropIn(state.departmentId);
      return;
    }

    const bookingFields = {
      [VEHICLE_ID_COLUMN]: vehicle.id,
      start: reservationStart,
      end: reservationEnd,
      usage: anvendelse,
      [USER_ID_COLUMN]: state.editingIsGuest ? null : bruger || session?.user.id || null,
      [DEPARTMENT_COLUMN]: state.departmentId,
    };

    let writeError: { code?: string; message: string } | null;
    let newBookingId: string | null = null;
    if (editingBookingId) {
      // .select() returns the updated rows: RLS silently narrows an update
      // the viewer may not make to 0 rows with no error, so an empty result
      // is reported instead of looking like a successful save.
      const { data: updatedRows, error } = await supabase
        .from("bookings")
        .update(bookingFields)
        .eq(BOOKING_ID_COLUMN, editingBookingId)
        .select(BOOKING_ID_COLUMN);
      writeError =
        error ?? (updatedRows?.length ? null : { message: "Reservationen kunne ikke opdateres — du har muligvis ikke tilladelse til det." });
    } else {
      const { data: insertedBooking, error } = await supabase
        .from("bookings")
        .insert(bookingFields)
        .select(BOOKING_ID_COLUMN)
        .single<{ booking_id: string }>();
      writeError = error;
      newBookingId = insertedBooking?.booking_id ?? null;
    }

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

    // Best-effort — the booking itself is already written by this point, so
    // a failure emailing the user it's for (missing SMTP config, etc.)
    // shouldn't block navigation or surface as if the booking itself failed.
    // Never fired for "Bekræft ændring" (editingBookingId set) — only a
    // brand-new reservation notifies its user, see
    // send-booking-confirmation.mts's own doc comment.
    if (newBookingId) {
      void callFunction("send-booking-confirmation", { body: { bookingId: newBookingId } }).catch(() => {
        // Ignored — see this block's own doc comment above.
      });
    }

    navigate(isAnyAdmin(profile?.role) ? "/allbookings" : "/bookings", { replace: true });
  };

  /**
   * Drop-in "Bekræft": one call to create-drop-in-booking.mts (see this
   * component's doc comment). A failed guest email doesn't undo the booking —
   * the details page's Gæst panel can send it again — so it's passed along
   * as `dropInEmailFailed` for that page to point out.
   */
  const confirmDropIn = async (departmentId: string) => {
    if (!dropInGuest) return;
    let response: Awaited<ReturnType<typeof callFunction<{ bookingId?: string; emailSent?: boolean }>>>;
    try {
      response = await callFunction<{ bookingId?: string; emailSent?: boolean }>("create-drop-in-booking", {
        body: {
          vehicleId: vehicle.id,
          departmentId,
          start: reservationStart,
          end: reservationEnd,
          usage: anvendelse,
          guest: dropInGuest,
        },
      });
    } catch {
      setError("Kunne ikke kontakte serveren. Prøv igen.");
      setIsSubmitting(false);
      return;
    }
    const result = response.data;
    if (!response.ok || !result.bookingId) {
      setError(result.error ?? "Kunne ikke oprette drop-in reservationen.");
      setIsSubmitting(false);
      return;
    }
    navigate(`/booking-details/${result.bookingId}`, {
      replace: true,
      state: { dropInEmailFailed: result.emailSent === false },
    });
  };

  /** [label, value] — Start/Slut show "dd/mm" (dropping the year). Kunde/afdeling comes first — a final, read-only "security check" confirming which department this booking is actually about to be written to, before "Bekræft" is pressed. Køretøj comes right after it. */
  const rows: [string, string][] = [
    ["Kunde/afdeling:", state?.departmentLabel ?? ""],
    ["Køretøj:", `${vehicle.plate}: ${vehicle.vehicle}`],
    ["Reserveret til:", brugerLabel],
    ...(dropInGuest
      ? ([
          ["Email:", dropInGuest.email],
          ["Telefon:", dropInGuest.phone],
          ["Adresse:", dropInGuest.address],
          ["Kørekort-nr.:", dropInGuest.licenseNo],
          ["Legitimation:", dropInGuest.idChecked ? "Kontrolleret" : "Ikke kontrolleret"],
        ] as [string, string][])
      : []),
    ["Anvendelse:", anvendelse],
    ["Start:", reservationStart ? formatDanishDateTimeShort(reservationStart) : ""],
    ["Slut:", reservationEnd ? formatDanishDateTimeShort(reservationEnd) : "Ingen slutdato"],
  ];

  return (
    <PageShell>
      <PageHeader />

          <PageSection>
            <PageSectionBody>
              <SectionHeading>
                {editingBookingId ? "Rediger reservation" : dropInGuest ? "Drop-in reservation" : "Opret reservation"}
              </SectionHeading>

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
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => navigate("/available", { state })}
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  Annuller
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  {isSubmitting ? "Bekræfter…" : editingBookingId ? "Bekræft ændring" : "Bekræft reservation"}
                </Button>
              </div>
            </PageSectionBody>
          </PageSection>
    </PageShell>
  );
}
