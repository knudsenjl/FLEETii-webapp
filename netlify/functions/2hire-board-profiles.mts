// Netlify Function: lists 2hire's own reusable vehicle-configuration
// profiles (see _shared/twoHireClient.ts's getTwoHireBoardProfiles) so
// VehicleCreatePage.tsx can offer a profile picker for the "Registrér
// køretøj i 2hire" step (registerVehicle needs a profileId). sysadm
// gated — same access level as the rest of that page (see App.tsx's
// requireRole="sysadm" on /vehicle-create).
//
// Per the "per-costumer 2hire credentials" plan: which 2hire account's
// profile catalog this lists depends on a credential, resolved the same way
// as every other function this plan touches — requires the caller to send
// ?costumerId=... (VehicleCreatePage.tsx already has order.costumer_id in
// scope where this is called). The route is sysadm-only, but the credential
// is resolved as the TARGET COSTUMER's — NOT the global
// one — so the profile catalog matches the account registerVehicle will
// register into (see 2hire-register-vehicle.mts).
import { getAdminClient } from "./_shared/adminClient.js";
import { requireSysadm } from "./_shared/serverAuth.js";
import { getTwoHireBoardProfiles } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials, twoHireErrorStatus } from "./_shared/twoHireCredentials.js";
import { json } from "./_shared/http.js";

export default async (req: Request) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await requireSysadm(req);
  if (!authResult.ok) {
    return json({ error: authResult.error }, authResult.status);
  }

  const costumerId = new URL(req.url).searchParams.get("costumerId")?.trim();
  if (!costumerId) {
    return json({ error: "costumerId er påkrævet." }, 400);
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return json({ error: adminClientResult.error }, adminClientResult.status);
  }
  const { admin } = adminClientResult;

  try {
    const credentials = await resolveTwoHireCredentials(admin, { costumerId });

    const profiles = await getTwoHireBoardProfiles(credentials);
    return json({ profiles }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return json({ error: message }, twoHireErrorStatus(error));
  }
};
