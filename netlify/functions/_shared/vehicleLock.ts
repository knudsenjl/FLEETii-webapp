// Shared server-side Lås/Lås op building blocks, used by every Function that
// lets someone other than an admin act on a vehicle's lock:
//   - set-vehicle-lock.mts (a regular user's own booking)
//   - 2hire-vehicle-command.mts ("locate", same audience)
//   - the drop-in guest functions (a token-authenticated guest's booking —
//     see the drop-in reservation plan)
// Extracted so the booking-window authorization and the "send the real 2hire
// command, then record it" sequence exist exactly once — the three callers
// must never drift apart on either, since both are security-relevant.
//
// The window rules themselves stay in src/lib/bookings.ts
// (computeLockButtonState/findAdjacentBookings), shared with the client-side
// button state (useVehicleLockState.ts); this file only loads what those
// pure functions need and applies them to a chosen booking.
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeLockButtonState, findAdjacentBookings, type LockButtonState } from "../../../src/lib/bookings.js";
import { nowUtcIso } from "../../../src/lib/time.js";
import { sendGenericCommand } from "./twoHireClient.js";
import { resolveTwoHireCredentials, twoHireErrorStatus } from "./twoHireCredentials.js";

/** A vehicle's booking, as needed to re-run computeLockButtonState/findAdjacentBookings server-side. */
export type VehicleBooking = { booking_id: string; start: string; end: string | null; user_id: string | null };

/** Everything the window rules need about one vehicle: all its bookings (to find a booking's neighbours) and its current persisted lock state. */
export type LockContext = { bookings: VehicleBooking[]; currentLocked: boolean };

/**
 * Loads a vehicle's LockContext via the service-role client. Throws (with a
 * Danish message) if either lookup fails. A vehicle with no persisted
 * `locked` signal yet counts as locked — the normal resting state of an
 * available vehicle, same default useVehicleLockState.ts uses.
 */
export async function loadLockContext(admin: SupabaseClient, vehicleId: string): Promise<LockContext> {
  const [{ data: signal, error: signalError }, { data: bookings, error: bookingsError }] = await Promise.all([
    admin.from("vehicle_signals").select("locked").eq("vehicle_id", vehicleId).maybeSingle<{ locked: boolean }>(),
    admin.from("bookings").select("booking_id, start, end, user_id").eq("vehicle_id", vehicleId).returns<VehicleBooking[]>(),
  ]);
  if (signalError) throw new Error(`Kunne ikke slå lås-status op: ${signalError.message}`);
  if (bookingsError) throw new Error(`Kunne ikke slå reservationer op: ${bookingsError.message}`);
  return { bookings: bookings ?? [], currentLocked: signal?.locked ?? true };
}

/** The Lås/Lås op button state for one of the context's bookings right now, per computeLockButtonState's three rules (its neighbours come from the same context). */
export function lockStateForBooking(context: LockContext, booking: VehicleBooking, now: string = nowUtcIso()): LockButtonState {
  const { previous, next } = findAdjacentBookings(context.bookings, booking.booking_id);
  return computeLockButtonState(
    now,
    { start: booking.start, end: booking.end },
    previous ? { end: previous.end } : null,
    next ? { start: next.start } : null,
    context.currentLocked,
  );
}

/**
 * Whether any booking the caller is entitled to (`isOwn` — e.g. "booked by
 * this user_id") currently satisfies `allows` on its button state. This is
 * the whole non-admin authorization rule: having a booking isn't enough, it
 * must be inside its own Lås/Lås op window right now.
 */
export function anyOwnBookingAllows(
  context: LockContext,
  isOwn: (booking: VehicleBooking) => boolean,
  allows: (state: LockButtonState) => boolean,
  now: string = nowUtcIso(),
): boolean {
  return context.bookings.filter(isOwn).some((booking) => allows(lockStateForBooking(context, booking, now)));
}

/** Result of sendAndRecordLock: ok, or an HTTP status + Danish error message ready to return as-is. */
export type LockCommandResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Sends the real 2hire lock/unlock command and, only once it succeeds,
 * records it:
 *   1. a 'lock'/'unlock' vehicle_signal_history row (keyed off the physical
 *      `command`, not the persisted `locked` flag — "Frigiv køretøj" sends
 *      "start" while persisting locked: true, and it's the physical unlock
 *      that matters for "who had the vehicle driveable"), with `actor` as its
 *      signal_value (who drove — e.g. { user_id });
 *   2. the persisted `locked` resting state, via the same
 *      upsert_vehicle_signal_if_newer() RPC every 2hire signal uses
 *      (vehicle_signals is a view over vehicle_signals_latest, not writable).
 * So vehicle_signals.locked always reflects a CONFIRMED real command, never
 * wishful thinking. A 2hire failure is surfaced (not swallowed) — the person
 * pressing the button needs to know the vehicle didn't respond. `costumerId`
 * is the TARGET vehicle's costumer, which picks the 2hire credential (see
 * resolveTwoHireCredentials). The caller must already have authorized the
 * action; `logTag` only prefixes server log lines.
 */
export async function sendAndRecordLock(
  admin: SupabaseClient,
  opts: {
    vehicleId: string;
    costumerId: string | null;
    command: "start" | "stop";
    locked: boolean;
    actor: Record<string, string>;
    logTag: string;
  },
): Promise<LockCommandResult> {
  const { vehicleId, costumerId, command, locked, actor, logTag } = opts;

  try {
    const credentials = await resolveTwoHireCredentials(admin, { costumerId });
    await sendGenericCommand(vehicleId, command, credentials);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    console.error(`[${logTag}] sendGenericCommand(${vehicleId}, ${command}) failed:`, message);
    return { ok: false, status: twoHireErrorStatus(error), error: message };
  }

  // One timestamp for both writes of this one logical event.
  const fulfilledAt = new Date().toISOString();
  const { error: historyError } = await admin.from("vehicle_signal_history").insert({
    vehicle_id: vehicleId,
    signal_type: command === "start" ? "unlock" : "lock",
    signal_value: actor,
    signal_timestamp: fulfilledAt,
  });
  if (historyError) {
    console.error(`[${logTag}] failed to record signal history:`, historyError);
    return { ok: false, status: 500, error: "Kunne ikke gemme lås-historik. Prøv igen." };
  }

  // This is the ONLY writer of the 'locked' signal anywhere in the app, so the
  // RPC's "reject if older" guard never actually has a race to protect
  // against here — kept only so every signal shares one write path.
  const { error: upsertError } = await admin.rpc("upsert_vehicle_signal_if_newer", {
    p_vehicle_id: vehicleId,
    p_signal: "locked",
    p_timestamp: fulfilledAt,
    p_data: { locked },
  });
  if (upsertError) {
    console.error(`[${logTag}] upsert failed:`, upsertError);
    return { ok: false, status: 500, error: "Kunne ikke gemme lås-status. Prøv igen." };
  }

  return { ok: true };
}
