// Netlify Function: the real "Registrér køretøj i 2hire" fulfillment action
// for a costumer_orders "Opret" order (VehicleCreatePage.tsx) — FLEETii-
// admin gated (same access level as the rest of that page). Registers a
// physical 2hire-board device (by its printed QR code, plus a chosen 2hire
// vehicle-configuration profile — see 2hire-board-profiles.mts) as a new
// vehicle in 2hire, then inserts the resulting vehicle into our own DB:
//   1. registerVehicle({qrCode, profileId}) -> real 2hire vehicleId
//   2. vehicle_profiles insert (vehicle_ident/number_plate/brand/model/
//      model_year/costumer_id/department_id snapshotted from the order —
//      iot_id left null, since nothing outside TwoHireTestPage.tsx's
//      e2e-simulator-only calls ever reads it for a real vehicle)
//   3. vehicle_departments insert (if the order has a department_id)
//   4. costumer_orders update: vehicle_id + vehicle_registered +
//      iot_device_associated all set together — 2hire's actual API has no
//      separate "associate IoT device" endpoint distinct from registration
//      (a device's QR code IS what's being associated when it's registered),
//      so these two checklist steps collapse into one real action here.
//
// Deliberately does NOT attempt to undo step 1 if steps 2-4 fail partway
// through (no compensating deregisterVehicle call) — a partial failure here
// leaves a real 2hire vehicle without a matching vehicle_profiles row, which
// is recoverable by retrying with the same qrCode/profileId (2hire will
// presumably reject/re-return the same registration) rather than by
// silently deregistering something FLEETii staff may already be relying on.
import { createClient } from "@supabase/supabase-js";
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";
import { registerVehicle } from "./_shared/twoHireClient.js";

type RegisterVehicleOrderBody = { orderId?: string; qrCode?: string; profileId?: string };

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

  let body: RegisterVehicleOrderBody;
  try {
    body = (await req.json()) as RegisterVehicleOrderBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const orderId = body.orderId?.trim();
  const qrCode = body.qrCode?.trim();
  const profileId = body.profileId?.trim();
  if (!orderId || !qrCode || !profileId) {
    return new Response(JSON.stringify({ error: "orderId, qrCode og profileId er påkrævet." }), { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: order } = await admin
    .from("costumer_orders")
    .select("order_type, costumer_id, department_id, vehicle_ident, number_plate, brand, model, model_year")
    .eq("order_id", orderId)
    .maybeSingle<{
      order_type: string;
      costumer_id: string;
      department_id: string | null;
      vehicle_ident: string | null;
      number_plate: string;
      brand: string;
      model: string;
      model_year: string;
    }>();

  if (!order) {
    return new Response(JSON.stringify({ error: "Bestillingen findes ikke." }), { status: 404 });
  }
  if (order.order_type !== "Opret") {
    return new Response(JSON.stringify({ error: "Denne bestilling er ikke en oprettelse." }), { status: 400 });
  }

  let vehicleId: string;
  try {
    const result = await registerVehicle({ qrCode, profileId });
    vehicleId = result.vehicleId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }

  const { error: profileError } = await admin.from("vehicle_profiles").upsert({
    vehicle_id: vehicleId,
    vehicle_ident: order.vehicle_ident,
    number_plate: order.number_plate,
    brand: order.brand,
    model: order.model,
    model_year: order.model_year,
    costumer_id: order.costumer_id,
    department_id: order.department_id,
  });
  if (profileError) {
    console.error("[2hire-register-vehicle] vehicle_profiles upsert failed:", profileError);
    return new Response(
      JSON.stringify({
        error: `Køretøjet blev registreret i 2hire (vehicleId: ${vehicleId}), men kunne ikke gemmes i FLEETii: ${profileError.message}`,
      }),
      { status: 500 },
    );
  }

  if (order.department_id) {
    const { error: departmentError } = await admin
      .from("vehicle_departments")
      .insert({ vehicle_id: vehicleId, department_id: order.department_id });
    if (departmentError) {
      console.error("[2hire-register-vehicle] vehicle_departments insert failed:", departmentError);
    }
  }

  const { error: orderError } = await admin
    .from("costumer_orders")
    .update({ vehicle_id: vehicleId, vehicle_registered: true, iot_device_associated: true })
    .eq("order_id", orderId);
  if (orderError) {
    console.error("[2hire-register-vehicle] costumer_orders update failed:", orderError);
  }

  return new Response(JSON.stringify({ ok: true, vehicleId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
