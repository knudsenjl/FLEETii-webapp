// Netlify Function: retries/backfills the dynamic-data push (position,
// battery — see _shared/vehicleTelemetrySync.ts) for a vehicle that's
// ALREADY been migrated to 2hire (see
// 2hire-migrate-vehicle.mts). That function's own push can partially fail
// (VEHICLE_LOCKED, MISSING_CONFIGURATION, ...) without blocking the
// migration itself, since the DB swap (the part that actually matters) has
// already succeeded by the time the push runs — this lets FLEETii staff
// retry just the push afterward, without redoing the whole registration
// (which 2hire-migrate-vehicle.mts's own idempotency guard blocks for a
// vehicle_id that's no longer flagged as mock data). FLEETii-admin gated,
// same as 2hire-migrate-vehicle.mts.
//
// Position/battery come from the frozen ORIGINAL_VEHICLE_TELEMETRY
// snapshot, NOT the live vehicle_signals row — confirmed live (migrating
// CS30731) that the live row can already be corrupted by 2hire's own
// default-state webhook by the time a resync runs, so reading it here would
// just push that corrupted default right back to 2hire in a feedback loop.
import { createClient } from "@supabase/supabase-js";
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";
import { pushDynamicDataToTwoHire } from "./_shared/vehicleTelemetrySync.js";
import { ORIGINAL_VEHICLE_TELEMETRY } from "./_shared/originalVehicleTelemetry.js";

type ResyncVehicleBody = { vehicleId?: string };

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

  let body: ResyncVehicleBody;
  try {
    body = (await req.json()) as ResyncVehicleBody;
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
    .select("iot_id, number_plate")
    .eq("vehicle_id", vehicleId)
    .maybeSingle<{ iot_id: string | null; number_plate: string }>();

  if (!vehicle) {
    return new Response(JSON.stringify({ error: "Køretøjet findes ikke." }), { status: 404 });
  }
  if (!vehicle.iot_id) {
    return new Response(JSON.stringify({ error: "Køretøjet har intet 2hire-device tilknyttet." }), { status: 400 });
  }

  // lat/lng/autonomy_percentage come from the frozen ORIGINAL_VEHICLE_TELEMETRY
  // snapshot instead of the live vehicle_signals row — see that file's own
  // doc comment for why the live row can't be trusted here (2hire's own
  // default-state webhook can have already overwritten it with a value that
  // has nothing to do with this vehicle's real original position/battery).
  const original = ORIGINAL_VEHICLE_TELEMETRY[vehicle.number_plate];

  const warning = await pushDynamicDataToTwoHire(vehicleId, vehicle.iot_id, {
    lat: original?.lat ?? null,
    lng: original?.lng ?? null,
    autonomy_percentage: original?.autonomyPercentage ?? null,
  });

  return new Response(JSON.stringify({ ok: true, warning }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
