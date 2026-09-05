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
// reused here, not reimplemented, so the two can't drift apart). A regular
// user also can't supply a `command` override — that's the admin-only Bloker/
// Frigiv path (VehicleDetailsPage.tsx), which physically locks/unlocks
// independent of the persisted `locked` flag; forcing the default mapping
// for non-admins closes the gap where an authorized `locked: true` request
// could otherwise sneak through `command: "start"` (a real unlock).
//
// Per the "per-costumer 2hire credentials" plan: the credential used to
// authenticate the real 2hire command is resolved from the TARGET vehicle's
// costumer_id (not the caller's own — a sysadm has none) plus whether
// the caller is a sysadm, same as every other function this plan
// touches.
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { computeLockButtonState, findAdjacentBookings, nowIsoString } from "../../src/lib/bookings.js";
import { getAdminClient } from "./_shared/adminClient.js";
import { isAnyAdminRole, isSysadmRole, requireUser } from "./_shared/serverAuth.js";
import { sendGenericCommand } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials } from "./_shared/twoHireCredentials.js";

/** A vehicle's booking, as needed to re-run computeLockButtonState/findAdjacentBookings server-side. */
type VehicleBooking = { booking_id: string; start: string; end: string | null; user_id: string | null };

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

  const [
    { data: vehicle, error: vehicleError },
    { data: caller, error: callerError },
    { data: signal, error: signalError },
    { data: bookings, error: bookingsError },
  ] = await Promise.all([
    admin
      .from("vehicle_profiles")
      .select("costumer_id")
      .eq("vehicle_id", vehicleId)
      .maybeSingle<{ costumer_id: string | null }>(),
    admin
      .from("user_profiles")
      .select("role, costumer_id")
      .eq("user_id", authResult.userId)
      .maybeSingle<{ role: string; costumer_id: string | null }>(),
    admin.from("vehicle_signals").select("locked").eq("vehicle_id", vehicleId).maybeSingle<{ locked: boolean }>(),
    admin
      .from("bookings")
      .select("booking_id, start, end, user_id")
      .eq("vehicle_id", vehicleId)
      .returns<VehicleBooking[]>(),
  ]);
  if (vehicleError) {
    return new Response(JSON.stringify({ error: `Kunne ikke slå køretøjet op: ${vehicleError.message}` }), { status: 500 });
  }
  if (callerError) {
    return new Response(JSON.stringify({ error: `Kunne ikke slå brugeren op: ${callerError.message}` }), { status: 500 });
  }
  if (signalError) {
    return new Response(JSON.stringify({ error: `Kunne ikke slå lås-status op: ${signalError.message}` }), { status: 500 });
  }
  if (bookingsError) {
    return new Response(JSON.stringify({ error: `Kunne ikke slå reservationer op: ${bookingsError.message}` }), { status: 500 });
  }
  if (!vehicle) {
    return new Response(JSON.stringify({ error: "Køretøjet blev ikke fundet." }), { status: 404 });
  }

  const isSysadm = isSysadmRole(caller?.role);
  const isAdmin = isAnyAdminRole(caller?.role);

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

    const currentLocked = signal?.locked ?? true;
    const ownBookings = (bookings ?? []).filter((b) => b.user_id === authResult.userId);
    const requiredFlag = locked ? "lockEnabled" : "unlockEnabled";
    const authorized = ownBookings.some((booking) => {
      const { previous, next } = findAdjacentBookings(bookings ?? [], booking.booking_id);
      const state = computeLockButtonState(
        nowIsoString(),
        { start: booking.start, end: booking.end },
        previous ? { end: previous.end } : null,
        next ? { start: next.start } : null,
        currentLocked,
      );
      return state[requiredFlag];
    });
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Du har ikke adgang til at låse/låse op for dette køretøj lige nu." }), {
        status: 403,
      });
    }
  }

  // Real 2hire command first — the vehicle_signals write below only happens
  // if this actually succeeds, so "locked" always reflects a confirmed real
  // state rather than wishful thinking. Expected to fail for any vehicle
  // that was never actually registered with 2hire (only WB20499 is today) —
  // surfaced as a normal error, not swallowed, since a regular user pressing
  // Lås/Lås op needs to know the vehicle didn't actually respond.
  try {
    const credentials = await resolveTwoHireCredentials(admin, {
      isSysadm,
      costumerId: vehicle.costumer_id,
    });

    await sendGenericCommand(vehicleId, command, credentials);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    console.error(`[set-vehicle-lock] sendGenericCommand(${vehicleId}, ${command}) failed:`, message);
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }

  // Record who drove: a 'lock'/'unlock' history row per fulfilled command,
  // keyed off the real physical `command` sent (not the persisted `locked`
  // resting-state flag below) — "Frigiv køretøj" sends command "start"
  // (a real unlock) while persisting locked: true, and it's the physical
  // unlock that matters for "who had the vehicle driveable", not the resting
  // flag. signal_value holds the driver's user_id, same shape convention as
  // 2hire-webhook.mts's own vehicle_signal_history inserts.
  const fulfilledAt = new Date().toISOString();
  const { error: historyError } = await admin.from("vehicle_signal_history").insert({
    vehicle_id: vehicleId,
    signal_type: command === "start" ? "unlock" : "lock",
    signal_value: { user_id: authResult.userId },
    signal_timestamp: fulfilledAt,
  });
  if (historyError) {
    console.error("[set-vehicle-lock] failed to record signal history:", historyError);
    return new Response(JSON.stringify({ error: "Kunne ikke gemme lås-historik. Prøv igen." }), { status: 500 });
  }

  // vehicle_signals is a compatibility VIEW over vehicle_signals_latest
  // (see vehicle_signals_to_narrow_schema.sql) — a plain .upsert() no
  // longer works against it (an aggregate view isn't directly writable).
  // Goes through the same generic upsert_vehicle_signal_if_newer() RPC
  // every real 2hire signal uses (see
  // upsert_vehicle_signal_if_newer_generic.sql), keyed as signal_type
  // 'locked'. This is the ONLY writer of 'locked' anywhere in the app, so
  // there's never actually a race for the RPC's "reject if older" guard to
  // protect against here — harmless, just pointless, kept only for
  // consistency with every other signal sharing one write path. Reuses
  // fulfilledAt (already computed above for the history insert) rather
  // than reading the clock twice for one logical write.
  const { error } = await admin.rpc("upsert_vehicle_signal_if_newer", {
    p_vehicle_id: vehicleId,
    p_signal: "locked",
    p_timestamp: fulfilledAt,
    p_data: { locked },
  });

  if (error) {
    console.error("[set-vehicle-lock] upsert failed:", error);
    return new Response(JSON.stringify({ error: "Kunne ikke gemme lås-status. Prøv igen." }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, locked }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
