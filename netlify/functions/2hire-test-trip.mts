// Netlify Function: ONE-OFF diagnostic — runs a specific multi-waypoint test
// trip (Milano -> München -> Frankfurt -> Hamburg -> Aarhus) on a given
// already-migrated vehicle, to test 2hire's own "How to test..." guide's
// documented claim that a vehicle transitions from "moving" to "unlocked"
// once the trip finishes. Not a permanent feature — this exists purely to
// investigate the webhook-delivery/settle behaviour explored in
// project_2hire_test_migration_roadmap (see memory), remove once done.
// FLEETii-admin gated, same as the other 2hire-migrate-vehicle.mts-adjacent
// functions.
import { createClient } from "@supabase/supabase-js";
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";
import { getDeviceState, sendGenericCommand, simulateTrip } from "./_shared/twoHireClient.js";

type TestTripBody = { vehicleId?: string };

/** Milano -> München -> Frankfurt am Main -> Hamburg -> Aarhus, approximate city-center coordinates. */
const MILANO_TO_AARHUS_TOUR = [
  { latitude: 45.4642, longitude: 9.19 }, // Milano
  { latitude: 48.1351, longitude: 11.582 }, // München
  { latitude: 50.1109, longitude: 8.6821 }, // Frankfurt am Main
  { latitude: 53.5511, longitude: 9.9937 }, // Hamburg
  { latitude: 56.1629, longitude: 10.2039 }, // Aarhus
];

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

  let body: TestTripBody;
  try {
    body = (await req.json()) as TestTripBody;
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
    // 2hire refuses simulateTrip while its own device is locked
    // (VEHICLE_LOCKED) — unlock first, same as the regular migration/resync
    // push does.
    await sendGenericCommand(vehicleId, "start");
    await simulateTrip(vehicle.iot_id, MILANO_TO_AARHUS_TOUR);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }

  let deviceState: unknown = null;
  try {
    deviceState = await getDeviceState(vehicle.iot_id);
  } catch (error) {
    deviceState = { error: error instanceof Error ? error.message : "Ukendt fejl." };
  }

  return new Response(JSON.stringify({ ok: true, deviceState }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
