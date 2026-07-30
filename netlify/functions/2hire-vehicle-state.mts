// Netlify Function: admin-triggered read of a simulated 2hire-board device's
// current state (see _shared/twoHireClient.ts's getDeviceState) — reached
// from TwoHireTestPage.tsx to show the REAL 2hire lock status (not our own
// virtual vehicle_signals.locked flag) on load and after each Lås/Lås op
// press. Returns a pre-computed `locked` boolean alongside the raw `status`
// string so the client doesn't need to know 2hire's exact status vocabulary
// ("LOCKED"/"UNLOCKED"/"MOVING") itself.
import { requireAdmin } from "./_shared/serverAuth.js";
import { getDeviceState } from "./_shared/twoHireClient.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const body = (await req.json().catch(() => null)) as { identifier?: string } | null;
  const identifier = body?.identifier;
  if (!identifier) {
    return new Response(JSON.stringify({ error: "identifier er påkrævet." }), { status: 400 });
  }

  try {
    const state = await getDeviceState(identifier);
    return new Response(JSON.stringify({ status: state.status, locked: state.status === "LOCKED" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
};
