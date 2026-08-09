// Netlify Function: sends the real 2hire lock/unlock command
// (sendGenericCommand "stop"/"start") and, only once that succeeds, persists
// the result as vehicle_signals.locked — so that flag now reflects the last
// CONFIRMED real command, not a purely virtual toggle (see
// supabase/vehicle_signals_add_locked.sql's original "deferred" framing,
// since superseded by this). Reached from useVehicleLockState.ts, used by
// the Lås/Lås op buttons on BookingDetailsPage.tsx and VehicleDetailsPage.tsx.
//
// requireUser-gated, not admin-only — a regular user needs to toggle the
// lock on their own reservation. Uses the service-role key for the
// vehicle_signals write, since that table deliberately has no client-side
// INSERT/UPDATE RLS policy (see vehicle_signals_table.sql) — same
// "service-role writes only" pattern as netlify/functions/2hire-webhook.mts.
//
// Does NOT re-validate the three button-activation rules server-side (see
// src/lib/bookings.ts's computeLockButtonState) — it trusts the calling UI's
// disabled-button state, matching this codebase's existing trust level
// elsewhere (e.g. booking deletion's permission check is also client-side
// only).
//
// Per the "per-costumer 2hire credentials" plan: the credential used to
// authenticate the real 2hire command is resolved from the TARGET vehicle's
// costumer_id (not the caller's own — a FLEETii admin has none) plus whether
// the caller is a FLEETii admin, same as every other function this plan
// touches. That lookup needs the service-role client, so it's built before
// the sendGenericCommand call now instead of after it.
import { createClient } from "@supabase/supabase-js";
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireUser } from "./_shared/serverAuth.js";
import { sendGenericCommand } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials } from "./_shared/twoHireCredentials.js";

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

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Serveren mangler SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY." }),
      { status: 500 },
    );
  }

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
  const command = body.command ?? (locked ? "stop" : "start");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Real 2hire command first — the vehicle_signals write below only happens
  // if this actually succeeds, so "locked" always reflects a confirmed real
  // state rather than wishful thinking. Expected to fail for any vehicle
  // that was never actually registered with 2hire (only WB20499 is today) —
  // surfaced as a normal error, not swallowed, since a regular user pressing
  // Lås/Lås op needs to know the vehicle didn't actually respond.
  try {
    const [{ data: vehicle, error: vehicleError }, { data: caller, error: callerError }] = await Promise.all([
      admin
        .from("vehicle_profiles")
        .select("costumer_id")
        .eq("vehicle_id", vehicleId)
        .maybeSingle<{ costumer_id: string | null }>(),
      admin
        .from("user_profiles")
        .select("role")
        .eq("user_id", authResult.userId)
        .maybeSingle<{ role: string }>(),
    ]);
    if (vehicleError) throw new Error(`Kunne ikke slå køretøjet op: ${vehicleError.message}`);
    if (callerError) throw new Error(`Kunne ikke slå brugeren op: ${callerError.message}`);

    const isFleetiiAdmin = caller?.role === "FLEETii admin";
    const credentials = await resolveTwoHireCredentials(admin, {
      isFleetiiAdmin,
      costumerId: vehicle?.costumer_id ?? null,
    });

    await sendGenericCommand(vehicleId, command, credentials);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    console.error(`[set-vehicle-lock] sendGenericCommand(${vehicleId}, ${command}) failed:`, message);
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }

  // Upsert, not update: a vehicle may not have a vehicle_signals row yet
  // (today only created by the 2hire webhook on its first signal) — a plain
  // update would silently no-op in that case.
  const { error } = await admin.from("vehicle_signals").upsert({ vehicle_id: vehicleId, locked });

  if (error) {
    console.error("[set-vehicle-lock] upsert failed:", error);
    return new Response(JSON.stringify({ error: "Kunne ikke gemme lås-status. Prøv igen." }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, locked }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
