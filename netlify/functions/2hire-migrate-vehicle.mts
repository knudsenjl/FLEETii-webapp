// Netlify Function: migrates one mock-data vehicle to a real 2hire
// test-adaptor registration (step 2 of the roadmap in project memory
// project_2hire_test_migration_roadmap.md — WB20499 was the pilot, this is
// how the other ~40 vehicles follow). FLEETii-admin gated. Reached from
// FleetiiAdministrationPage.tsx's "Migrering til 2hire (test)" section.
//
// Sequence (order matters — a webhook signal for the new vehicleId can't
// land anywhere until vehicle_profiles has a row for it):
//   1. Look up the vehicle's ORIGINAL position/battery from the frozen
//      ORIGINAL_VEHICLE_TELEMETRY snapshot (see its own doc comment for why
//      — the live vehicle_signals row isn't safe to read for this once any
//      2hire interaction has happened, confirmed live migrating CS30731:
//      2hire's own default initial state for every simulated device
//      overwrites lat/lng/autonomy_percentage via webhook, and reading that
//      back out on a later retry just pushes the corrupted default right
//      back to 2hire).
//   2. createSimulatedDevice() (e2e host) -> {identifier, qrCode} — a real
//      physical device already has both, but these 40 vehicles don't have
//      one, so a simulated device stands in for it, same as WB20499's own
//      one-time migration did.
//   3. registerVehicle({qrCode, profileId: TWOHIRE_SIMULATOR_PROFILE_ID}) ->
//      the real 2hire vehicleId. Per 2hire's own docs, THIS fixed profileId
//      is mandatory for any simulated device — using one of
//      getTwoHireBoardProfiles()'s real make/model profiles instead (an
//      earlier version of this function did, best-effort-matched by brand)
//      causes 2hire to reject later generic commands with
//      MISSING_CONFIGURATION (confirmed live, migrating CN61538).
//   4. migrate_vehicle_to_2hire() (SQL, SECURITY DEFINER) — atomically
//      clones vehicle_profiles under the new id, repoints
//      vehicle_departments/bookings/vehicle_log/vehicle_signals, drops the
//      old placeholder row. See its own migration file for why this can't
//      just be a plain UPDATE of the primary key.
//   5. Best-effort push of the snapshotted dynamic data to the new
//      simulated device (see _shared/vehicleTelemetrySync.ts's own doc
//      comment for exactly what this does and why) — distance_covered has
//      no 2hire setter at all (same root cause as the tracked "dynamics"
//      webhook gap), so it can't be carried forward; the migrated row's
//      existing value just stays frozen. A partial failure here doesn't
//      block the migration itself — see 2hire-resync-vehicle.mts to retry
//      just this step afterward.
import { createClient } from "@supabase/supabase-js";
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";
import { pushDynamicDataToTwoHire } from "./_shared/vehicleTelemetrySync.js";
import { createSimulatedDevice, registerVehicle, TWOHIRE_SIMULATOR_PROFILE_ID } from "./_shared/twoHireClient.js";
import { ORIGINAL_VEHICLE_TELEMETRY } from "./_shared/originalVehicleTelemetry.js";

type MigrateVehicleBody = { vehicleId?: string };

/** The mock-fixture iot_id prefix (see seed_vehicle_profiles.sql) — a vehicle whose iot_id no longer starts with this has already been migrated (or was never a mock vehicle to begin with). */
const MOCK_IOT_ID_PREFIX = "2H2000";

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

  let body: MigrateVehicleBody;
  try {
    body = (await req.json()) as MigrateVehicleBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const oldVehicleId = body.vehicleId?.trim();
  if (!oldVehicleId) {
    return new Response(JSON.stringify({ error: "vehicleId er påkrævet." }), { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: vehicle } = await admin
    .from("vehicle_profiles")
    .select("iot_id, number_plate")
    .eq("vehicle_id", oldVehicleId)
    .maybeSingle<{ iot_id: string | null; number_plate: string }>();

  if (!vehicle) {
    return new Response(JSON.stringify({ error: "Køretøjet findes ikke." }), { status: 404 });
  }
  if (!vehicle.iot_id || !vehicle.iot_id.startsWith(MOCK_IOT_ID_PREFIX)) {
    return new Response(JSON.stringify({ error: "Køretøjet er allerede migreret." }), { status: 409 });
  }

  const original = ORIGINAL_VEHICLE_TELEMETRY[vehicle.number_plate];

  let identifier: string;
  let qrCode: string;
  try {
    const device = await createSimulatedDevice();
    identifier = device.identifier;
    qrCode = device.qrCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }

  let newVehicleId: string;
  try {
    const result = await registerVehicle({ qrCode, profileId: TWOHIRE_SIMULATOR_PROFILE_ID });
    newVehicleId = result.vehicleId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }

  const { error: migrateError } = await admin.rpc("migrate_vehicle_to_2hire", {
    old_vehicle_id: oldVehicleId,
    new_vehicle_id: newVehicleId,
    new_iot_id: identifier,
  });
  if (migrateError) {
    console.error(
      `[2hire-migrate-vehicle] migrate_vehicle_to_2hire failed after a successful 2hire registration (oldVehicleId=${oldVehicleId}, newVehicleId=${newVehicleId}, iot_id=${identifier}) — needs manual follow-up:`,
      migrateError,
    );
    return new Response(
      JSON.stringify({
        error: `Køretøjet blev registreret i 2hire (vehicleId: ${newVehicleId}), men databasen kunne ikke opdateres: ${migrateError.message}. Kræver manuel opfølgning.`,
      }),
      { status: 500 },
    );
  }

  const telemetryWarning = await pushDynamicDataToTwoHire(newVehicleId, identifier, {
    lat: original?.lat ?? null,
    lng: original?.lng ?? null,
    autonomy_percentage: original?.autonomyPercentage ?? null,
  });

  return new Response(JSON.stringify({ ok: true, oldVehicleId, newVehicleId, telemetryWarning }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
