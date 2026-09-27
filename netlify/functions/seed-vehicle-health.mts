// Netlify Function behind the "Seed Vehicle Health Data" button on the
// sysadm-only /test-center page (TestCenterPage.tsx): writes fake 2hire
// signals so every vehicle-health outcome of src/lib/vehicleHealth.ts (OK /
// amber warning / red error) can be seen on the fleet table. All the work is
// done by the database function staging_seed_health_scenarios() (see
// supabase/staging_health_scenarios.sql for the 10 scenarios and how to
// restore the original data); this only guards and calls it.
//
// Kept off production by testDataGuard.ts's three independent checks (not
// the production site; connected to the staging database by an allowlist;
// the database itself marked as staging), a required { confirmed: true }
// body from the page's confirmation dialog, and — besides those — the seed
// function existing in the staging database only and refusing to run where
// live signal history exists.
import { getAdminClient } from "./_shared/adminClient.js";
import { requireSysadm } from "./_shared/serverAuth.js";
import { json } from "./_shared/http.js";
import { isConfirmedSeedRequest, testDataDatabaseBlocked, testDataEnvironmentBlocked } from "./_shared/testDataGuard.js";

/** One row of staging_seed_health_scenarios()'s result: which vehicle got which scenario, and what the marker should show. */
type SeededScenario = { vehicle: string; costumer: string; scenario: string; expected: string };

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const environmentBlocked = testDataEnvironmentBlocked();
  if (environmentBlocked) return environmentBlocked;

  const authResult = await requireSysadm(req);
  if (!authResult.ok) {
    return json({ error: authResult.error }, authResult.status);
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return json({ error: adminClientResult.error }, adminClientResult.status);
  }

  const body = await req.json().catch(() => null);
  if (!isConfirmedSeedRequest(body)) {
    return json({ error: "Handlingen skal bekræftes." }, 400);
  }

  const { admin } = adminClientResult;
  const databaseBlocked = await testDataDatabaseBlocked(admin);
  if (databaseBlocked) return databaseBlocked;

  const { data, error } = await admin.rpc("staging_seed_health_scenarios");
  if (error) {
    console.error("[seed-vehicle-health] seeding failed:", error);
    return json({ error: `Kunne ikke oprette testdata: ${error.message}` }, 500);
  }

  return json({ scenarios: (data ?? []) as SeededScenario[] });
};
