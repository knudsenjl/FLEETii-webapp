// Netlify Function: sends the real 2hire lock/unlock command
// (sendGenericCommand "stop"/"start") and, only once that succeeds, persists
// the result as vehicle_signals.locked — so that flag now reflects the last
// CONFIRMED real command, not a purely virtual toggle (see
// supabase/vehicle_signals_add_locked.sql's original "deferred" framing,
// since superseded by this). Also appends a 'lock'/'unlock' row to
// vehicle_signal_history (see vehicle_signal_history_table.sql) recording
// which user_id fulfilled the command and when — this is a real 2hire
// command FLEETii itself sent, not a signal 2hire pushed to us, so it can't
// go through 2hire-webhook.mts; this is the only other writer of that table.
// Reached from useVehicleLockState.ts, used by the Lås/Lås op buttons on
// BookingDetailsPage.tsx and VehicleDetailsPage.tsx.
//
// requireUser-gated, not admin-only — a regular user needs to toggle the
// lock on their own reservation. The vehicle_signals write goes through the
// upsert_vehicle_signal_if_newer() RPC (SECURITY DEFINER, service-role
// caller) — same "service-role writes only" pattern as
// netlify/functions/2hire-webhook.mts, which every other signal on this
// table also goes through.
//
// Re-validates authorization server-side rather than trusting the calling
// UI's disabled-button state: a sysadm may act on any vehicle; a
// regular "admin" only on their own costumer's vehicles (same scoping
// VehiclesPage.tsx already applies to what an admin can even see); a regular
// user only if one of their OWN bookings on this vehicle currently has the
// requested action enabled, per the exact same three rules the button uses
// (see src/lib/bookings.ts's computeLockButtonState/findAdjacentBookings —
// reused here via _shared/vehicleLock.ts, not reimplemented, so the two
// can't drift apart). The 2hire command + history/signal writes also live
// there (sendAndRecordLock), shared with the drop-in guest path. A regular
// user also can't supply a `command` override — that's the admin-only Bloker/
// Frigiv path (VehicleDetailsPage.tsx), which physically locks/unlocks
// independent of the persisted `locked` flag; forcing the default mapping
// for non-admins closes the gap where an authorized `locked: true` request
// could otherwise sneak through `command: "start"` (a real unlock).
//
// Per the "per-costumer 2hire credentials" plan: the credential used to
// authenticate the real 2hire command is resolved from the TARGET vehicle's
// costumer_id (not the caller's own — a sysadm has none), same as every
// other function this plan touches.
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { getAdminClient } from "./_shared/adminClient.js";
import { isAnyAdminRole, isSysadmRole, requireUser } from "./_shared/serverAuth.js";
import { anyOwnBookingAllows, loadLockContext, sendAndRecordLock } from "./_shared/vehicleLock.js";

// `command`, if present, overrides which real 2hire generic command is sent
// (default: `locked ? "stop" : "start"`) while `locked` still controls what
// gets persisted to vehicle_signals — lets a caller send one physical
// command while recording a different resting state. Used by
// VehicleDetailsPage.tsx's "Frigiv køretøj" (sends "start" to release the
// 2hire-side immobilization, but persists locked: true, the normal
// available-vehicle resting state — see useVehicleLockState.ts's setLock).
type SetVehicleLockBody = { vehicleId?: string; locked?: boolean; command?: "start" | "stop" };

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  let body: SetVehicleLockBody;
  try {
    body = (await req.json()) as SetVehicleLockBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const vehicleId = asTrimmedString(body.vehicleId);
  if (!vehicleId) {
    return new Response(JSON.stringify({ error: "vehicleId er påkrævet." }), { status: 400 });
  }
  if (typeof body.locked !== "boolean") {
    return new Response(JSON.stringify({ error: "locked skal være true eller false." }), { status: 400 });
  }
  if (body.command !== undefined && body.command !== "start" && body.command !== "stop") {
    return new Response(JSON.stringify({ error: "command skal være start eller stop." }), { status: 400 });
  }
  const locked = body.locked;

  const [{ data: vehicle, error: vehicleError }, { data: caller, error: callerError }] = await Promise.all([
    admin
      .from("vehicle_profiles")
      .select("costumer_id")
      .eq("vehicle_id", vehicleId)
      .maybeSingle<{ costumer_id: string | null }>(),
    admin
      .from("user_profiles")
      .select("role, costumer_id, deleted_at")
      .eq("user_id", authResult.userId)
      .maybeSingle<{ role: string; costumer_id: string | null; deleted_at: string | null }>(),
  ]);
  if (vehicleError) {
    return new Response(JSON.stringify({ error: `Kunne ikke slå køretøjet op: ${vehicleError.message}` }), { status: 500 });
  }
  if (callerError) {
    return new Response(JSON.stringify({ error: `Kunne ikke slå brugeren op: ${callerError.message}` }), { status: 500 });
  }
  if (!vehicle) {
    return new Response(JSON.stringify({ error: "Køretøjet blev ikke fundet." }), { status: 404 });
  }

  // An archived user (delete-user.mts bans the login AND sets deleted_at)
  // can still hold a valid access token until it expires (up to ~1 hour) —
  // requireUser alone only proves the token is valid, so refuse them here.
  if (!caller || caller.deleted_at) {
    return new Response(JSON.stringify({ error: "Din bruger er ikke længere aktiv." }), { status: 403 });
  }

  const isSysadm = isSysadmRole(caller.role);
  const isAdmin = isAnyAdminRole(caller.role);

  let command = body.command ?? (locked ? "stop" : "start");

  if (isSysadm) {
    // full access, any vehicle
  } else if (isAdmin) {
    if (!caller?.costumer_id || caller.costumer_id !== vehicle.costumer_id) {
      return new Response(JSON.stringify({ error: "Du har ikke adgang til dette køretøj." }), { status: 403 });
    }
  } else {
    // Regular user: only the admin-only Bloker/Frigiv flow ever needs a
    // command that diverges from the plain locked->command mapping — force
    // it back to the default so an authorized `locked` value can't be paired
    // with a physically opposite `command` (see this file's header comment).
    command = locked ? "stop" : "start";

    // Same costumer scoping as the admin branch above, checked before
    // trusting any booking: bookings' own RLS now also requires the booked
    // vehicle to belong to the booking's department (see
    // bookings_restore_tillad_flags_and_vehicle_department_check.sql), but a
    // booking row alone must never be enough to unlock another costumer's
    // vehicle — e.g. one inserted before that policy existed.
    if (!caller?.costumer_id || caller.costumer_id !== vehicle.costumer_id) {
      return new Response(JSON.stringify({ error: "Du har ikke adgang til dette køretøj." }), { status: 403 });
    }

    let authorized: boolean;
    try {
      const context = await loadLockContext(admin, vehicleId);
      const requiredFlag = locked ? "lockEnabled" : "unlockEnabled";
      authorized = anyOwnBookingAllows(
        context,
        (b) => b.user_id === authResult.userId,
        (state) => state[requiredFlag],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ukendt fejl.";
      return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Du har ikke adgang til at låse/låse op for dette køretøj lige nu." }), {
        status: 403,
      });
    }
  }

  // Real 2hire command first, then the history row (signal_value records
  // the driver's user_id — "who drove") and the persisted `locked` flag —
  // see sendAndRecordLock. Expected to fail for any vehicle never actually
  // registered with 2hire; surfaced as a normal error.
  const result = await sendAndRecordLock(admin, {
    vehicleId,
    costumerId: vehicle.costumer_id,
    command,
    locked,
    actor: { user_id: authResult.userId },
    logTag: "set-vehicle-lock",
  });
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: result.status });
  }

  return new Response(JSON.stringify({ ok: true, locked }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
