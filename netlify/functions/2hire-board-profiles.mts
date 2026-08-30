// Netlify Function: lists 2hire's own reusable vehicle-configuration
// profiles (see _shared/twoHireClient.ts's getTwoHireBoardProfiles) so
// VehicleCreatePage.tsx can offer a profile picker for the "Registrér
// køretøj i 2hire" step (registerVehicle needs a profileId). FLEETii-admin
// gated — same access level as the rest of that page (see App.tsx's
// requireRole="FLEETii admin" on /vehicle-create).
//
// Per the "per-costumer 2hire credentials" plan: which 2hire account's
// profile catalog this lists depends on a credential, resolved the same way
// as every other function this plan touches — requires the caller to send
// ?costumerId=... (VehicleCreatePage.tsx already has order.costumer_id in
// scope where this is called) even though this route stays FLEETii-admin-only
// (always resolves to the global credential in practice — see
// delete-vehicle.mts's identical reasoning for resolving fresh rather than
// hardcoding).
import { getAdminClient } from "./_shared/adminClient.js";
import { isFleetiiAdminRole, requireFleetiiAdmin } from "./_shared/serverAuth.js";
import { getTwoHireBoardProfiles } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials } from "./_shared/twoHireCredentials.js";

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireFleetiiAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const costumerId = new URL(req.url).searchParams.get("costumerId")?.trim();
  if (!costumerId) {
    return new Response(JSON.stringify({ error: "costumerId er påkrævet." }), { status: 400 });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  try {
    const { data: caller, error: callerError } = await admin
      .from("user_profiles")
      .select("role")
      .eq("user_id", authResult.userId)
      .maybeSingle<{ role: string }>();
    if (callerError) throw new Error(`Kunne ikke slå brugeren op: ${callerError.message}`);

    const isFleetiiAdmin = isFleetiiAdminRole(caller?.role);
    const credentials = await resolveTwoHireCredentials(admin, { isFleetiiAdmin, costumerId });

    const profiles = await getTwoHireBoardProfiles(credentials);
    return new Response(JSON.stringify({ profiles }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
};
