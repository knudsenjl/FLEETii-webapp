// Netlify Function: lists 2hire's own reusable vehicle-configuration
// profiles (see _shared/twoHireClient.ts's getTwoHireBoardProfiles) so
// VehicleCreatePage.tsx can offer a profile picker for the "Registrér
// køretøj i 2hire" step (registerVehicle needs a profileId). FLEETii-admin
// gated — same access level as the rest of that page (see App.tsx's
// requireRole="FLEETii admin" on /vehicle-create).
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";
import { getTwoHireBoardProfiles } from "./_shared/twoHireClient.js";

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireFleetiiAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  try {
    const profiles = await getTwoHireBoardProfiles();
    return new Response(JSON.stringify({ profiles }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
};
