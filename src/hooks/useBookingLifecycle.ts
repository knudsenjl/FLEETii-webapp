// Shared "act on one active booking" logic for BookingPage.tsx (role
// "user"'s mobile landing page) and BookingDetailsPage.tsx (admin/FLEETii
// admin's table-layout view of a single booking) — the two pages differ
// substantially in layout and in what they show (BookingDetailsPage has
// extra admin-only rows, its own department lookup, table layout vs.
// BookingPage's mobile hero card), but both act on an identical "one active
// booking" shape via identical handlers: fetch the vehicle's own
// Køretøj-ID/Drivmiddel/blocked-state, cancel it, finish it early, re-enter
// the edit flow, Blink/Horn, and the two Tillad_slet_reservation/
// Tillad_rediger_reservation permission checks. Centralizing this avoids the
// two pages' handlers drifting apart the way their layouts already have.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { useVehicleLockState } from "./useVehicleLockState";
import { useTimedFlag } from "./useTimedFlag";
import { useLocateVehicle } from "./useLocateVehicle";
import { supabase } from "../lib/supabase";
import { isSettingTilladt } from "../lib/settings";
import { BOOKING_ID_COLUMN, bookingUserLabel, toDisplayVehicle, type EditingBooking } from "../lib/bookings";
import { nowUtcIso, toUtcMs } from "../lib/time";

/** The fields BookingPage.tsx/BookingDetailsPage.tsx both need for the shared actions below — same shape each page's own fetch (fresh-on-mount for BookingPage, router-state-or-fetch-by-id for BookingDetailsPage) already produces. */
export type LifecycleBooking = {
  id: string;
  vehicle: string;
  startIso: string;
  endIso: string | null;
  use: string;
  userId: string | null;
  userEmail: string | null;
  userIdent: string | null;
  departmentId: string | null;
  /** Drop-in booking fields (see MappedBooking) — optional, since BookingPage.tsx only ever shows a user's own, never-drop-in booking. */
  isGuest?: boolean;
  guestName?: string | null;
};

/** The genuine Køretøj-ID/Nummerplade pair (plus Drivmiddel and blocked-state) for a booking's vehicle — fetched straight from vehicle_profiles rather than reusing the 2hire vehicle's own plate field, since that's an UNGATED vehicle_ident-or-number_plate fallback and callers need to respect useVehicleIdent themselves. */
export type VehicleIdentInfo = {
  vehicleIdent: string | null;
  numberPlate: string | null;
  drivmiddel: string | null;
  blocked: boolean;
};

/**
 * Bundles every action BookingPage.tsx/BookingDetailsPage.tsx take on their
 * one active booking: navigate to VehicleDetailsPage, re-enter the edit flow
 * (ReservationPage), cancel (with its own confirm-dialog state), finish
 * early (ditto), Blink, Horn, plus the vehicle's own Køretøj-ID/Drivmiddel/
 * blocked lookup and the two Tillad_slet_reservation/
 * Tillad_rediger_reservation permission checks. Each page still owns its own
 * layout/rendering and its own admin-only extras (BookingDetailsPage's
 * department lookup, Bruger/Kilometerstand/Status rows, isAdmin overrides
 * folded into canShowDeleteButton/canShowEditButton) — only the genuinely
 * identical mechanics live here.
 */
export function useBookingLifecycle(
  booking: LifecycleBooking | null,
  opts: {
    /** Passed straight through to useVehicleLockState — true unlocks both Lås/Lås op buttons regardless of the booking's own window (admin/sysadm on BookingDetailsPage); always false on BookingPage (role "user" only, no admin override to make there). */
    isAdminLock: boolean;
    /** Whether to use the Bruger-ID (see bookingUserLabel) instead of booking.userEmail as goToEditBooking's userLabel prefill — see useIdentSettings' own doc comment. */
    useUserIdent: boolean;
    userId: string | undefined;
    /** The BOOKING's OWN department (booking.departmentId), for the Tillad_slet_reservation/Tillad_rediger_reservation checks below — NOT the viewer's ambient/header-selected afdelingId. For BookingPage.tsx (role "user") the two happen to be identical (a user only ever has bookings in their own department); BookingDetailsPage.tsx (admin/sysadm, who can view any department's booking) must pass the booking's own departmentId explicitly instead. */
    afdelingId: string | null;
  },
) {
  const navigate = useNavigate();
  const vehicles = use2hireVehicle();
  const twoHireVehicle = booking ? vehicles.find((v) => v.vehicleId === booking.vehicle) : undefined;

  const [vehicleIdentInfo, setVehicleIdentInfo] = useState<VehicleIdentInfo | null>(null);
  useEffect(() => {
    if (!booking) return;

    let cancelled = false;
    void supabase
      .from("vehicle_profiles")
      .select("vehicle_ident, number_plate, drivmiddel, blocked_at")
      .eq("vehicle_id", booking.vehicle)
      .maybeSingle<{ vehicle_ident: string | null; number_plate: string | null; drivmiddel: string | null; blocked_at: string | null }>()
      .then(({ data }) => {
        if (cancelled) return;
        setVehicleIdentInfo(
          data
            ? {
                vehicleIdent: data.vehicle_ident,
                numberPlate: data.number_plate,
                drivmiddel: data.drivmiddel,
                blocked: data.blocked_at !== null,
              }
            : null,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [booking?.vehicle]);

  /** "Slet reservation" is always shown for role=admin (folded in by callers via canShowDeleteButton = isAdmin || userMayDeleteBooking); for role=user, only when Tillad_slet_reservation is true for this department. */
  const [userMayDeleteBooking, setUserMayDeleteBooking] = useState(false);
  /** Same as above, for "Rediger reservation"/Tillad_rediger_reservation. */
  const [userMayEditBooking, setUserMayEditBooking] = useState(false);
  useEffect(() => {
    void isSettingTilladt("Tillad_slet_reservation", opts.userId, opts.afdelingId).then(setUserMayDeleteBooking);
  }, [opts.userId, opts.afdelingId]);
  useEffect(() => {
    void isSettingTilladt("Tillad_rediger_reservation", opts.userId, opts.afdelingId).then(setUserMayEditBooking);
  }, [opts.userId, opts.afdelingId]);

  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    locked: vehicleLocked,
    lockEnabled,
    unlockEnabled,
    loading: lockStateLoading,
    setLock,
    error: lockError,
  } = useVehicleLockState(
    booking?.vehicle ?? "",
    booking ? { bookingId: booking.id, startIso: booking.startIso, endIso: booking.endIso } : null,
    opts.isAdminLock,
  );
  /** "Køretøjet er nu låst/låst op"/"Lygterne blinker" confirmation shown for 3s right after a successful setLock/locate. */
  const { activeKey: lockConfirmationKey, trigger: triggerLockConfirmation } = useTimedFlag();
  const { isLocating, locateError, locate } = useLocateVehicle();

  /** Every role can navigate to VehicleDetailsPage — see that page's own doc comment, which already accounts for a regular user landing there via their own booking (its map/edit/delete actions stay separately admin-gated within that page itself). */
  const goToVehicleDetails = () => {
    if (!twoHireVehicle || !booking) return;
    navigate(`/vehicle-details/${twoHireVehicle.vehicleId}`, {
      state: {
        vehicle: toDisplayVehicle(twoHireVehicle),
        booking: { id: booking.id, startIso: booking.startIso, endIso: booking.endIso },
      },
    });
  };

  /** Starts the "Rediger reservation" flow: back through ReservationPage -> (optionally) AvailablePage -> ConfirmPage, pre-filled with this booking's current bruger/anvendelse/start/end/vehicle, updating this row (by booking_id) instead of inserting a new one. */
  const goToEditBooking = () => {
    if (!booking) return;
    const editing: EditingBooking = {
      bookingId: booking.id,
      userId: booking.userId,
      userLabel: bookingUserLabel(booking, opts.useUserIdent),
      anvendelse: booking.use,
      startIso: booking.startIso,
      endIso: booking.endIso,
      vehicleId: booking.vehicle,
      departmentId: booking.departmentId,
      isGuest: booking.isGuest ?? false,
    };
    navigate("/reservation", { state: { editing } });
  };

  /** Deletes this booking and returns to the bookings list. */
  const handleCancelBooking = async () => {
    if (!booking) return;
    setIsCancelling(true);
    setError(null);

    const { error: deleteError } = await supabase.from("bookings").delete().eq(BOOKING_ID_COLUMN, booking.id);

    if (deleteError) {
      setError(deleteError.message);
      setIsCancelling(false);
      setShowCancelConfirm(false);
      return;
    }

    navigate("/bookings", { replace: true });
  };

  /** Ends this booking early: locks the vehicle, then sets its "end" to now — unlike "Slet reservation", the booking row itself isn't deleted, just shortened to end at this moment. If locking fails, the booking is left untouched (see useVehicleLockState's own error) rather than shortening a booking whose vehicle didn't actually get secured. */
  const handleFinishBooking = async () => {
    if (!booking) return;
    setIsFinishing(true);
    setError(null);

    const lockSuccess = await setLock(true);
    if (!lockSuccess) {
      setIsFinishing(false);
      setShowFinishConfirm(false);
      return;
    }

    const { error: updateError } = await supabase.from("bookings").update({ end: nowUtcIso() }).eq(BOOKING_ID_COLUMN, booking.id);

    if (updateError) {
      setError(updateError.message);
      setIsFinishing(false);
      setShowFinishConfirm(false);
      return;
    }

    navigate("/bookings", { replace: true });
  };

  /** "Blink": sends 2hire's real "locate" command via useLocateVehicle — same audience as Lås/Lås op (any user with a relevant booking, see 2hire-vehicle-command.mts's own doc comment on the auth split). */
  const handleLocate = async () => {
    if (!booking) return;
    const success = await locate(booking.vehicle);
    if (success) triggerLockConfirmation("located");
  };

  /** "Horn": intentionally a stub — 2hire's generic-command API doesn't have a confirmed horn/honk command yet (see 2hire-vehicle-command.mts), so this just surfaces "Endnu ikke implementeret" until the right command is found. Reuses the same lockConfirmationKey as Lås/Lås op/Blink rather than a second useTimedFlag instance, since only one of these popups is ever relevant at a time. */
  const handleHonk = () => {
    triggerLockConfirmation("horn");
  };

  /** "Afslut reservation" is enabled only within the booking's own period — from its start until its end (or always, for an open-ended booking), compared as UTC instants, same as computeLockButtonState. */
  const nowMs = Date.now();
  const canFinishBooking = booking
    ? nowMs >= toUtcMs(booking.startIso) && !(booking.endIso !== null && nowMs >= toUtcMs(booking.endIso))
    : false;

  return {
    twoHireVehicle,
    vehicleIdentInfo,
    userMayDeleteBooking,
    userMayEditBooking,
    isCancelling,
    showCancelConfirm,
    setShowCancelConfirm,
    isFinishing,
    showFinishConfirm,
    setShowFinishConfirm,
    error,
    vehicleLocked,
    lockEnabled,
    unlockEnabled,
    lockStateLoading,
    setLock,
    lockError,
    lockConfirmationKey,
    triggerLockConfirmation,
    isLocating,
    locateError,
    canFinishBooking,
    goToVehicleDetails,
    goToEditBooking,
    handleCancelBooking,
    handleFinishBooking,
    handleLocate,
    handleHonk,
  };
}
