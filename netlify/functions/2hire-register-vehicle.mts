// Netlify Function: admin-triggered action that registers a physical
// 2hire-board device (by its printed QR code) as a new vehicle in 2hire (see
// _shared/twoHireClient.ts's registerVehicle). Not called by any page yet —
// the caller is expected to already have the device's qrCode (from the unit
// itself) and a profileId (from GET /api/v1/connectivity-provider/2hire-board/profile,
// see getTwoHireBoardProfiles). This only registers the vehicle with 2hire
// and returns the resulting vehicleId — it does NOT insert anything into our
// own vehicle_profiles table, that's a separate, deliberate step (see
// supabase/applied/seed_vehicle_profiles.sql for the shape that insert takes).
import { requireAdmin } from "./_shared/serverAuth.js";
import { registerVehicle } from "./_shared/twoHireClient.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const body = (await req.json().catch(() => null)) as { qrCode?: string; profileId?: string } | null;
  const qrCode = body?.qrCode;
  const profileId = body?.profileId;
  if (!qrCode || !profileId) {
    return new Response(JSON.stringify({ error: "qrCode og profileId er påkrævet." }), { status: 400 });
  }

  try {
    const { vehicleId } = await registerVehicle({ qrCode, profileId });
    return new Response(JSON.stringify({ vehicleId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
};
