// Netlify Function: ONE-OFF diagnostic — reads 2hire's own current
// getDeviceState for a vehicle WITHOUT sending any command (unlike
// 2hire-resync-vehicle.mts/2hire-test-trip.mts, both of which push new data
// first) — safe to call while a trip is still in progress, to check its
// current progress without risking restarting/interrupting it. FLEETii-
// admin gated. Not a permanent feature, remove once done investigating.
import { createClient } from "@supabase/supabase-js";
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";
import { getDeviceState } from "./_shared/twoHireClient.js";

type CheckVehicleStateBody = { vehicleId?: string };

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

  let body: CheckVehicleStateBody;
  try {
    body = (await req.json()) as CheckVehicleStateBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const vehicleId = body.vehicleId?.trim();
  if (!vehicleId) {
    return new Response(JSON.stringify({ error: "vehicleId er påkrævet." }), { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: vehicle } = await admin
    .from("vehicle_profiles")
    .select("iot_id")
    .eq("vehicle_id", vehicleId)
    .maybeSingle<{ iot_id: string | null }>();

  if (!vehicle?.iot_id) {
    return new Response(JSON.stringify({ error: "Køretøjet har intet 2hire-device tilknyttet." }), { status: 400 });
  }

  try {
    const deviceState = await getDeviceState(vehicle.iot_id);
    return new Response(JSON.stringify({ ok: true, deviceState }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
};
