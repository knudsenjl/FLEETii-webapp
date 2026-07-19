// Shared "Lås/Lås op button state" logic for BookingDetailsPage.tsx and
// VehicleDetailsPage.tsx, so the fetch+compute work isn't duplicated between
// them. Fetches the vehicle's persisted virtual lock flag (see
// supabase/vehicle_signals_add_locked.sql for why it's virtual, not a real
// 2hire signal) plus its other bookings, and applies the three
// button-activation rules via computeLockButtonState — only for a regular
// user with a relevant booking; admins always get both buttons enabled.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import {
  computeLockButtonState,
  findAdjacentBookings,
  nowIsoString,
  VEHICLE_ID_COLUMN,
  type BookingNeighbor,
} from "../lib/bookings";

/** The current user's own reservation for this vehicle, if any — the context computeLockButtonState needs. A null endIso means the booking is open-ended (see bookings.ts's BookingRow doc comment), not "no booking" — don't treat it as missing context. */
export type VehicleLockBookingContext = { bookingId: number; startIso: string; endIso: string | null };

export type VehicleLockState = {
  /** null while still loading, or if the vehicle has no vehicle_signals row yet (treated as locked by default). */
  locked: boolean | null;
  lockEnabled: boolean;
  unlockEnabled: boolean;
  loading: boolean;
  /** Persists a new lock state via set-vehicle-lock, then refreshes all derived state. */
  setLock: (locked: boolean) => Promise<void>;
  error: string | null;
};

/**
 * `booking` is the regular user's own reservation for `vehicleId` (or null
 * if there isn't one relevant on this page) — the three activation rules
 * only apply when `isAdmin` is false AND `booking` is present; otherwise
 * both buttons report enabled for admins, or disabled (safe default) for a
 * regular user with no booking context.
 */
export function useVehicleLockState(
  vehicleId: string,
  booking: VehicleLockBookingContext | null,
  isAdmin: boolean,
): VehicleLockState {
  const { session } = useAuth();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [lockEnabled, setLockEnabled] = useState(isAdmin);
  const [unlockEnabled, setUnlockEnabled] = useState(isAdmin);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bookingId = booking?.bookingId;
  const bookingStartIso = booking?.startIso;
  const bookingEndIso = booking?.endIso;

  const reload = useCallback(async () => {
    setLoading(true);

    const [signalResult, bookingsResult] = await Promise.all([
      supabase.from("vehicle_signals").select("locked").eq(VEHICLE_ID_COLUMN, vehicleId).maybeSingle<{ locked: boolean }>(),
      supabase
        .from("bookings")
        .select("booking_id, start, end")
        .eq(VEHICLE_ID_COLUMN, vehicleId)
        .returns<BookingNeighbor[]>(),
    ]);

    const currentLocked = signalResult.data?.locked ?? true;
    setLocked(currentLocked);

    if (isAdmin) {
      setLockEnabled(true);
      setUnlockEnabled(true);
      setLoading(false);
      return;
    }

    if (!bookingId || !bookingStartIso) {
      setLockEnabled(false);
      setUnlockEnabled(false);
      setLoading(false);
      return;
    }

    const { previous, next } = findAdjacentBookings(bookingsResult.data ?? [], bookingId);
    const state = computeLockButtonState(
      nowIsoString(),
      { start: bookingStartIso, end: bookingEndIso ?? null },
      previous ? { end: previous.end } : null,
      next ? { start: next.start } : null,
      currentLocked,
    );
    setLockEnabled(state.lockEnabled);
    setUnlockEnabled(state.unlockEnabled);
    setLoading(false);
  }, [vehicleId, isAdmin, bookingId, bookingStartIso, bookingEndIso]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setLock = useCallback(
    async (nextLocked: boolean) => {
      setError(null);
      try {
        const response = await fetch("/.netlify/functions/set-vehicle-lock", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ vehicleId, locked: nextLocked }),
        });

        const result = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(result.error ?? "Kunne ikke opdatere lås-status.");
          return;
        }
      } catch {
        setError("Kunne ikke kontakte serveren. Prøv igen senere.");
        return;
      }

      await reload();
    },
    [vehicleId, session, reload],
  );

  return { locked, lockEnabled, unlockEnabled, loading, setLock, error };
}
