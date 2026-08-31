// Netlify Function: the real, terminal step of "Slet køretøj" — FLEETii-
// internal only (see requireFleetiiAdmin below), reached from
// VehicleDeletePage.tsx once staff have confirmed the physical 2hire device
// has been removed (costumer_orders.device_removed on the "Nedlæg" order —
// see costumer_orders_merge_deletion_requests.sql). Re-verifies that
// server-side (order_type === "Nedlæg", vehicle_id === the target vehicle,
// device_removed === true) before touching anything — requireFleetiiAdmin()
// alone only proves a trusted caller, not that THIS orderId actually names a
// confirmed deletion request for THIS vehicle, and the client-supplied
// orderId/vehicleId pairing was otherwise never cross-checked. Best-effort
// deregisters the vehicle from 2hire, then deletes it from our own DB via
// the delete_vehicle() SQL function (SECURITY DEFINER, execute revoked from
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
import { getAdminClient } from "./_shared/adminClient.js";
import { isFleetiiAdminRole, requireFleetiiAdmin } from "./_shared/serverAuth.js";
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

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

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

  // Confirms orderId is actually THE fulfilled deletion request for
  // vehicleId before anything irreversible happens (deregistering from
  // 2hire, then deleting the vehicle) — not just before the final
  // costumer_orders delete below. Without this, a mistaken or crafted
  // orderId (e.g. a copy-paste error, or a stale value from a different
  // vehicle's page) would delete whichever unrelated Opret/Nedlæg order it
  // happens to name, silently destroying a legitimate pending request while
  // leaving the REAL deletion request for the now-gone vehicle orphaned
  // forever (its own vehicle_id no longer exists to retry against). Checks
  // all three of order_type/vehicle_id/device_removed — see
  // costumer_orders_merge_deletion_requests.sql for why exactly these three
  // columns mean "this order is a confirmed, fulfilled Nedlæg for THIS
  // vehicle": device_removed is what VehicleDeletePage.tsx's own confirm
  // step sets, and is the actual "staff has physically removed the 2hire
  // device" signal this whole flow exists to gate on.
  const { data: order, error: orderError } = await admin
    .from("costumer_orders")
    .select("order_type, vehicle_id, device_removed")
    .eq("order_id", orderId)
    .maybeSingle<{ order_type: string; vehicle_id: string | null; device_removed: boolean }>();
  if (orderError) {
    return new Response(JSON.stringify({ error: orderError.message }), { status: 500 });
  }
  if (!order) {
    return new Response(JSON.stringify({ error: "Ordren findes ikke." }), { status: 404 });
  }
  if (order.order_type !== "Nedlæg" || order.vehicle_id !== vehicleId) {
    return new Response(JSON.stringify({ error: "Ordren er ikke en nedlæggelsesordre for dette køretøj." }), { status: 400 });
  }
  if (!order.device_removed) {
    return new Response(JSON.stringify({ error: "Fjernelse af enheden er endnu ikke bekræftet for denne ordre." }), { status: 409 });
  }

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

    const isFleetiiAdmin = isFleetiiAdminRole(caller?.role);
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
