// Netlify Function: the real, terminal step of "Slet køretøj" — FLEETii-
// internal only (see requireFleetiiAdmin below), reached from
// VehicleDeletePage.tsx once staff have confirmed the physical 2hire device
// has been removed (costumer_orders.device_removed on the "Nedlæg" order —
// see costumer_orders_merge_deletion_requests.sql). Best-effort deregisters
// the vehicle from 2hire, then deletes it from our own DB via the
// delete_vehicle() SQL function (SECURITY DEFINER, execute revoked from
// anon/authenticated), called via the service-role client exactly like
// delete-costumer.mts calls purge_costumer: no ownership check inside the
// SQL function itself, since the caller is fully trusted at this point.
//
// Per the "per-costumer 2hire credentials" plan: deregisterVehicle needs the
// TARGET vehicle's own credential (its costumer's sub-account, not
// necessarily the global one) even though this route is itself
// FLEETii-admin-gated — resolveTwoHireCredentials always resolves the
// caller's role fresh rather than assuming "FLEETii-admin route therefore
// always global", so the logic stays correct if this route's access ever
// widens.
import { createClient } from "@supabase/supabase-js";
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";
import { deregisterVehicle } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials } from "./_shared/twoHireCredentials.js";

type DeleteVehicleBody = { vehicleId?: string; orderId?: string };

/**
 * POST { vehicleId, orderId } as a FLEETii admin. Best-effort deregisters
 * vehicleId from 2hire (most vehicles were never actually registered there,
 * so a failure here is expected, not fatal), calls delete_vehicle(vehicleId)
 * to actually remove the vehicle_departments/vehicle_signals/vehicle_profiles
 * rows, then deletes the now-fulfilled costumer_orders row (best-effort —
 * the vehicle being gone is what matters). Returns
 * { ok: true, deregisterWarning } — deregisterWarning is non-null whenever
 * the 2hire deregistration failed, which VehicleDeletePage.tsx shows as an
 * informational note, not an error, since it's the expected case for
 * ~39 of ~40 vehicles today.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireFleetiiAdmin(req);
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

  let body: DeleteVehicleBody;
  try {
    body = (await req.json()) as DeleteVehicleBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const vehicleId = body.vehicleId?.trim();
  const orderId = body.orderId?.trim();
  if (!vehicleId || !orderId) {
    return new Response(JSON.stringify({ error: "vehicleId og orderId er påkrævet." }), { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let deregisterWarning: string | null = null;
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

    await deregisterVehicle(vehicleId, credentials);
  } catch (error) {
    deregisterWarning = error instanceof Error ? error.message : "Ukendt fejl ved 2hire-afregistrering.";
    console.warn(`[delete-vehicle] deregisterVehicle(${vehicleId}) failed (continuing):`, deregisterWarning);
  }

  const { error: deleteError } = await admin.rpc("delete_vehicle", { target_vehicle_id: vehicleId });
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
  }

  const { error: orderDeleteError } = await admin.from("costumer_orders").delete().eq("order_id", orderId);
  if (orderDeleteError) {
    console.error(
      `[delete-vehicle] costumer_orders delete failed for ${orderId} (vehicle already deleted):`,
      orderDeleteError,
    );
  }

  return new Response(JSON.stringify({ ok: true, deregisterWarning }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
