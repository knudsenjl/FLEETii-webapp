// Netlify Function backing TestCenterPage.tsx's "Signalværdi" section
// (sysadm-only): reads the CURRENT value of one generic or specific 2hire
// signal for one vehicle, straight from 2hire (GET /api/v1/vehicle/{id}/
// signal/{generic|specific}/{signal} — see twoHireClient.ts's
// fetchVehicleSignal). Read-only: unlike 2hire-backfill-vehicle-signals.mts
// it never writes the reading to vehicle_signal_history/
// vehicle_signals_latest, it just shows it.
//
// The vehicle is picked by number plate (same case-insensitive lookup as
// 2hire-raw-command.mts's "{plate}" placeholders) and read with its OWN
// costumer's sub-account credential (resolveTwoHireCredentials) — the
// vehicle lives in that sub-account, so the global credential can't be
// assumed to reach it.
import { getAdminClient } from "./_shared/adminClient.js";
import { requireSysadm } from "./_shared/serverAuth.js";
import { fetchGenericVehicleSignal, fetchSpecificVehicleSignal } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials, twoHireErrorStatus } from "./_shared/twoHireCredentials.js";
import { json } from "./_shared/http.js";

/** What a plate may contain — interpolated into an ilike filter, so no PostgREST filter syntax (see 2hire-raw-command.mts's PLATE_PATTERN). */
const PLATE_PATTERN = /^[\p{L}\p{N} ]+$/u;

/** 2hire signal names are snake_case identifiers (distance_covered, trip_detected, …). */
const SIGNAL_PATTERN = /^[A-Za-z0-9_-]+$/;

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await requireSysadm(req);
  if (!authResult.ok) {
    return json({ error: authResult.error }, authResult.status);
  }

  const body = (await req.json().catch(() => null)) as { plate?: string; kind?: string; signal?: string } | null;
  const plate = body?.plate?.trim() ?? "";
  const signal = body?.signal?.trim() ?? "";
  const kind = body?.kind;
  if (!PLATE_PATTERN.test(plate)) {
    return json({ error: "Angiv en gyldig nummerplade (kun bogstaver, tal og mellemrum)." }, 400);
  }
  if (kind !== "generic" && kind !== "specific") {
    return json({ error: 'kind skal være "generic" eller "specific".' }, 400);
  }
  if (!SIGNAL_PATTERN.test(signal)) {
    return json({ error: "Angiv et gyldigt signalnavn (f.eks. distance_covered)." }, 400);
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return json({ error: adminClientResult.error }, adminClientResult.status);
  }
  const { admin } = adminClientResult;

  const { data: vehicles, error: vehicleError } = await admin
    .from("vehicle_profiles")
    .select("vehicle_id, number_plate, costumer_id")
    .ilike("number_plate", plate)
    .returns<{ vehicle_id: string; number_plate: string | null; costumer_id: string | null }[]>();
  if (vehicleError) {
    return json({ error: `Kunne ikke slå nummerpladen op: ${vehicleError.message}` }, 500);
  }
  if (!vehicles || vehicles.length === 0) {
    return json({ error: `Intet køretøj fundet med nummerplade "${plate}".` }, 404);
  }
  if (vehicles.length > 1) {
    return json({ error: `Flere køretøjer har nummerplade "${plate}".` }, 409);
  }
  const vehicle = vehicles[0];

  try {
    const credentials = await resolveTwoHireCredentials(admin, { costumerId: vehicle.costumer_id });
    const reading =
      kind === "generic"
        ? await fetchGenericVehicleSignal(vehicle.vehicle_id, signal, credentials)
        : await fetchSpecificVehicleSignal(vehicle.vehicle_id, signal, credentials);

    return json(
      {
        vehicleId: vehicle.vehicle_id,
        numberPlate: vehicle.number_plate,
        kind,
        signal,
        found: reading !== null,
        data: reading?.data ?? null,
        timestamp: reading ? new Date(reading.timestampMs).toISOString() : null,
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return json({ error: message }, twoHireErrorStatus(error));
  }
};
