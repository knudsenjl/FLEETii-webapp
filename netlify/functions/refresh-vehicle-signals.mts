// Netlify Function: re-reads specific signals straight from 2hire for
// vehicles whose reading looks stale, and stores whatever comes back —
// requested by the "!" vehicle-health marker (src/hooks/
// useStaleSignalRefresh.ts) before it settles on a warning, so a webhook
// delivery 2hire skipped doesn't show up as a sensor problem (user request
// 2026-09-27). The reading is stored like any other (persistVehicleSignal:
// history + timestamp-guarded latest state), so an older reading changes
// nothing and a newer one simply replaces the stale value.
//
// Admin or sysadm (the only roles that see the marker). A regular admin may
// only refresh vehicles of their own costumer; each vehicle is read with its
// own costumer's 2hire credential, same as the signal backfill.
import { getAdminClient } from "./_shared/adminClient.js";
import { persistVehicleSignal } from "./_shared/persistVehicleSignal.js";
import { mapWithConcurrency } from "./_shared/concurrency.js";
import { isSysadmRole, requireAdmin } from "./_shared/serverAuth.js";
import { fetchGenericVehicleSignal, type TwoHireCredentials } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials } from "./_shared/twoHireCredentials.js";
import { json } from "./_shared/http.js";

/** The only signals the health rule judges by age — see src/lib/vehicleHealth.ts. All three are 2hire "generic" signals. */
const REFRESHABLE_SIGNALS = new Set(["position", "distance_covered", "autonomy_percentage"]);
/** Upper bound per call — the fleet table batches every stale vehicle it shows into one request. */
const MAX_VEHICLES = 100;
const CONCURRENT_REQUESTS = 10;

type RefreshRequest = { vehicleId: string; signals: string[] };

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return json({ error: authResult.error }, authResult.status);
  }

  const body = (await req.json().catch(() => null)) as { requests?: unknown } | null;
  const requests = Array.isArray(body?.requests) ? (body.requests as RefreshRequest[]) : null;
  if (
    !requests ||
    requests.length === 0 ||
    requests.length > MAX_VEHICLES ||
    !requests.every(
      (r) =>
        typeof r?.vehicleId === "string" &&
        Array.isArray(r.signals) &&
        r.signals.length > 0 &&
        r.signals.every((s) => REFRESHABLE_SIGNALS.has(s)),
    )
  ) {
    return json({ error: "Ugyldig forespørgsel." }, 400);
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return json({ error: adminClientResult.error }, adminClientResult.status);
  }
  const { admin } = adminClientResult;

  const { data: caller, error: callerError } = await admin
    .from("user_profiles")
    .select("role, costumer_id")
    .eq("user_id", authResult.userId)
    .maybeSingle<{ role: string; costumer_id: string | null }>();
  if (callerError || !caller) {
    return json({ error: "Kunne ikke slå din profil op." }, 500);
  }

  const { data: vehicles, error: vehiclesError } = await admin
    .from("vehicle_profiles")
    .select("vehicle_id, costumer_id")
    .in(
      "vehicle_id",
      requests.map((r) => r.vehicleId),
    )
    .returns<{ vehicle_id: string; costumer_id: string | null }[]>();
  if (vehiclesError) {
    return json({ error: `vehicle_profiles: ${vehiclesError.message}` }, 500);
  }
  const costumerByVehicle = new Map((vehicles ?? []).map((v) => [v.vehicle_id, v.costumer_id]));
  const isSysadm = isSysadmRole(caller.role);
  if (
    requests.some(
      (r) => !costumerByVehicle.has(r.vehicleId) || (!isSysadm && costumerByVehicle.get(r.vehicleId) !== caller.costumer_id),
    )
  ) {
    return json({ error: "Du har ikke adgang til et eller flere af køretøjerne." }, 403);
  }

  // One credential lookup per costumer, shared by concurrent workers.
  const credentialsByCostumer = new Map<string, Promise<TwoHireCredentials>>();
  const credentialsFor = (costumerId: string | null) => {
    const key = costumerId ?? "";
    let cached = credentialsByCostumer.get(key);
    if (!cached) {
      cached = resolveTwoHireCredentials(admin, { costumerId });
      credentialsByCostumer.set(key, cached);
    }
    return cached;
  };

  const pairs = requests.flatMap((r) => [...new Set(r.signals)].map((signal) => ({ vehicleId: r.vehicleId, signal })));
  let stored = 0;
  let noData = 0;
  let failed = 0;
  await mapWithConcurrency(pairs, CONCURRENT_REQUESTS, async ({ vehicleId, signal }) => {
    try {
      const credentials = await credentialsFor(costumerByVehicle.get(vehicleId) ?? null);
      const reading = await fetchGenericVehicleSignal(vehicleId, signal, credentials);
      if (!reading) {
        noData += 1;
        return;
      }
      await persistVehicleSignal(admin, vehicleId, signal, reading);
      stored += 1;
    } catch (error) {
      failed += 1;
      console.error(`[refresh-vehicle-signals] ${vehicleId}/${signal}:`, error);
    }
  });

  return json({ requested: pairs.length, stored, noData, failed });
};
