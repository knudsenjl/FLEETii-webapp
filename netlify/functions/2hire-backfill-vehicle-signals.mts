// Netlify Function backing TwoHireCommandPage.tsx's "Signal-backfill"
// section (sysadm-only): a one-off maintenance action, NOT something run
// automatically or on a schedule. For every vehicle in vehicle_profiles that
// has no vehicle_signals_latest row (or an outdated one is fine — the
// timestamp guard in upsert_vehicle_signal_if_newer handles that) for one of
// the six signals this app tracks, fetches the current reading straight from
// 2hire and persists it — same fetchGenericVehicleSignal/
// fetchSpecificVehicleSignal/persistVehicleSignal path 2hire-register-
// vehicle.mts uses right after a fresh registration, just applied
// retroactively to vehicles that were registered before that seeding step
// existed (or before a given signal was added to its list — see
// GENERIC_SIGNALS/SPECIFIC_SIGNALS below, kept in sync with
// 2hire-register-vehicle.mts's own GENERIC_SIGNALS_TO_SEED/
// SPECIFIC_SIGNALS_TO_SEED by hand, since there's no shared constant between
// the two yet and this file is expected to be short-lived).
//
// Each vehicle is fetched with its OWN costumer's sub-account credential
// (resolveTwoHireCredentials, cached per costumer for the run) — vehicles
// live in their costumer's 2hire sub-account, so the global credential
// can't be assumed to reach them.
//
// dryRun: true previews (fetches from 2hire, reports what WOULD be written,
// writes nothing) — always try this first. dryRun: false (or omitted)
// actually writes.
import { getAdminClient } from "./_shared/adminClient.js";
import { persistVehicleSignal } from "./_shared/persistVehicleSignal.js";
import { requireSysadm } from "./_shared/serverAuth.js";
import {
  fetchGenericVehicleSignal,
  fetchSpecificVehicleSignal,
  type TwoHireCredentials,
} from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials } from "./_shared/twoHireCredentials.js";

const GENERIC_SIGNALS = ["distance_covered", "autonomy_percentage", "autonomy_meters", "position", "online"] as const;
const SPECIFIC_SIGNALS = ["trip_detected"] as const;

/**
 * How many (vehicle, signal) pairs to fetch from 2hire at once. A full-fleet
 * × full-signal-list run can be a couple hundred pairs — running them
 * sequentially (as the original standalone backfill-distance-covered.mjs
 * script did, with no time limit since it ran on a laptop) easily blows past
 * Netlify's synchronous function execution limit. This function has no time
 * budget to spare, so pairs are fetched CONCURRENT_REQUESTS at a time
 * instead of one at a time with an artificial delay between each.
 */
const CONCURRENT_REQUESTS = 10;

type SignalTarget = { kind: "generic" | "specific"; signal: string };
const ALL_SIGNALS: SignalTarget[] = [
  ...GENERIC_SIGNALS.map((signal) => ({ kind: "generic" as const, signal })),
  ...SPECIFIC_SIGNALS.map((signal) => ({ kind: "specific" as const, signal })),
];

type BackfillFailure = { vehicleId: string; numberPlate: string | null; signal: string; error: string };

async function fetchOne(target: SignalTarget, vehicleId: string, credentials: TwoHireCredentials) {
  return target.kind === "generic"
    ? fetchGenericVehicleSignal(vehicleId, target.signal, credentials)
    : fetchSpecificVehicleSignal(vehicleId, target.signal, credentials);
}

/** Runs `worker` over every item in `items`, at most `concurrency` in flight at once — a plain Promise.all would fire all of them at once, which is exactly what CONCURRENT_REQUESTS exists to avoid. */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function runNext(): Promise<void> {
    const index = nextIndex++;
    if (index >= items.length) return;
    await worker(items[index]);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireSysadm(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  const body = (await req.json().catch(() => null)) as { dryRun?: boolean } | null;
  const dryRun = body?.dryRun !== false; // defaults to true — a real run must opt in explicitly

  const { data: vehicles, error: vehiclesError } = await admin
    .from("vehicle_profiles")
    .select("vehicle_id, number_plate, costumer_id")
    .returns<{ vehicle_id: string; number_plate: string | null; costumer_id: string | null }[]>();
  if (vehiclesError) {
    return new Response(JSON.stringify({ error: `vehicle_profiles: ${vehiclesError.message}` }), { status: 500 });
  }

  const { data: existingSignals, error: signalsError } = await admin
    .from("vehicle_signals_latest")
    .select("vehicle_id, signal_type")
    .returns<{ vehicle_id: string; signal_type: string }[]>();
  if (signalsError) {
    return new Response(JSON.stringify({ error: `vehicle_signals_latest: ${signalsError.message}` }), {
      status: 500,
    });
  }

  const existingPairs = new Set((existingSignals ?? []).map((row) => `${row.vehicle_id} ${row.signal_type}`));

  // One credential lookup per costumer, memoized as a promise so concurrent
  // workers for the same costumer share it. A costumer whose credential can't
  // be resolved rejects here, and is reported per-pair as a failure below.
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

  const missingPairs = (vehicles ?? []).flatMap((vehicle) =>
    ALL_SIGNALS.filter((target) => !existingPairs.has(`${vehicle.vehicle_id} ${target.signal}`)).map((target) => ({
      vehicle,
      target,
    })),
  );

  let applied = 0;
  let noData = 0;
  const failures: BackfillFailure[] = [];

  await runWithConcurrency(missingPairs, CONCURRENT_REQUESTS, async ({ vehicle, target }) => {
    try {
      const credentials = await credentialsFor(vehicle.costumer_id);
      const reading = await fetchOne(target, vehicle.vehicle_id, credentials);
      if (!reading) {
        noData += 1;
      } else {
        if (!dryRun) {
          await persistVehicleSignal(admin, vehicle.vehicle_id, target.signal, reading);
        }
        applied += 1;
      }
    } catch (error) {
      failures.push({
        vehicleId: vehicle.vehicle_id,
        numberPlate: vehicle.number_plate,
        signal: target.signal,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return new Response(
    JSON.stringify({
      dryRun,
      totalVehicles: (vehicles ?? []).length,
      signalsChecked: ALL_SIGNALS.map((t) => t.signal),
      missingCount: missingPairs.length,
      applied,
      noData,
      failedCount: failures.length,
      failures,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
